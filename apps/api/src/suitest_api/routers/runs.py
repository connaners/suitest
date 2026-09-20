"""Run / run-step / log / artifact read endpoints (docs/API.md §3.5).

All scoped via project -> workspace. ``GET /runs/:id/logs`` concatenates each
RunStep's stdout + stderr in step_order into a flat line stream and paginates it
with a simple integer line-offset cursor (M1a; a richer per-chunk cursor lands
with live streaming in M3). Artifact download produces a presigned URL via
aioboto3 (object store) or a placeholder for ``file://`` artifacts.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

import anyio
from arq.connections import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from suitest_db.audit import write_audit
from suitest_db.models.case import TestCase, TestStep
from suitest_db.models.run import Artifact, Run, RunStep
from suitest_db.models.user import User
from suitest_db.repositories.projects import ProjectRepo
from suitest_db.repositories.run_step_logs import RunStepLogRepo
from suitest_db.repositories.runs import RunRepo
from suitest_db.repositories.runs import RunSummary as DbRunSummary
from suitest_shared.domain.enums import RunStatus
from suitest_shared.schemas.pagination import Page, PageMeta

from suitest_api.auth.db import get_async_session
from suitest_api.auth.manager import current_active_user_optional
from suitest_api.deps.api_key import tenant_via_api_key_or_session
from suitest_api.deps.arq import get_arq
from suitest_api.deps.run_dispatch import dispatch_run
from suitest_api.deps.scope import TenantContext, require_workspace_membership
from suitest_api.routers._pagination import decode_cursor_or_400, encode_next
from suitest_api.schemas.run import (
    ArtifactPublic,
    ArtifactSignedUrl,
    PlaywrightConfig,
    RunCaseSummary,
    RunDetail,
    RunListItem,
    RunLogItem,
    RunLogPage,
    RunNetworkResponse,
    RunReplayResponse,
    RunReplayStep,
    RunsSummary,
    RunStepPublic,
    RunSummary,
    StateChangePublic,
)
from suitest_api.schemas.runs import (
    CreateRunBody,
    CreateSuiteRunBody,
    RerunRunBody,
    RunPublic,
)
from suitest_api.services.file_storage import (
    create_media_token,
    get_s3_object_meta,
    is_internal_s3_endpoint,
    presign_s3_get,
    stream_s3_artifact,
    verify_media_token,
)
from suitest_api.services.junit_report_service import render_junit
from suitest_api.services.replay_service import StateChange, compute_state_delta
from suitest_api.services.run_service import RunService
from suitest_api.settings import get_settings

# ARQ queue name shared with the runner. Hardcoded here (vs. importing
# ``RunnerSettings``) so the api package does not depend on the runner package
# — runner is a separate process and its settings module pulls a redis client
# on import. Keep in sync with ``suitest_runner.worker.WorkerSettings.queue_name``.
_RUNS_QUEUE = "suitest:runs"
_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["runs"])


def _public_state_changes(changes: list[StateChange]) -> list[StateChangePublic]:
    return [
        StateChangePublic(path=change.path, op=change.op, before=change.before, after=change.after)
        for change in changes
    ]


async def _project_in_scope(session: AsyncSession, project_id: str, workspace_id: str) -> bool:
    project = await ProjectRepo(session).get_by_id(project_id)
    return project is not None and project.workspace_id == workspace_id


async def _run_in_scope_or_404(session: AsyncSession, run_id: str, workspace_id: str) -> str:
    """Resolve a run reference (internal id OR public_id like ``R-1004``) to its
    internal id, 404ing when it doesn't exist or is cross-workspace.

    The web routes on the per-workspace ``public_id``; step/artifact queries need
    the internal id, so callers must use the value returned from here on.
    """
    repo = RunRepo(session)
    resolved = await repo.resolve_id(run_id, workspace_id)
    run = await repo.get_by_id(resolved) if resolved is not None else None
    if run is None or not await _project_in_scope(session, run.project_id, workspace_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    return run.id


async def _reconcile_lazy_interrupted_run(
    session: AsyncSession,
    run: Run,
    steps: list[RunStep] | None = None,
    *,
    commit: bool = True,
) -> bool:
    """If run is RUNNING with no activity for >15 minutes, mark INTERRUPTED."""
    if run.status != RunStatus.RUNNING:
        return False
    now = datetime.now(UTC)
    cutoff = timedelta(minutes=15)
    candidates = [run.updated_at, run.started_at, run.created_at]
    if steps:
        candidates.extend([s.completed_at or s.started_at or s.created_at for s in steps])
    elif steps is None:
        latest_step_time = await session.scalar(
            select(
                func.max(
                    func.coalesce(RunStep.completed_at, RunStep.started_at, RunStep.created_at)
                )
            ).where(RunStep.run_id == run.id)
        )
        if isinstance(latest_step_time, datetime):
            candidates.append(latest_step_time)
    valid_candidates = [
        c if c.tzinfo is not None else c.replace(tzinfo=UTC) for c in candidates if c is not None
    ]
    if not valid_candidates:
        return False
    last_activity = max(valid_candidates)
    if now - last_activity > cutoff:
        run.status = RunStatus.INTERRUPTED
        run.completed_at = last_activity
        if run.started_at is not None:
            started = (
                run.started_at
                if run.started_at.tzinfo is not None
                else run.started_at.replace(tzinfo=UTC)
            )
            run.duration_ms = max(0, int((last_activity - started).total_seconds() * 1000))
        meta = dict(run.metadata_json or {})
        reason = "Execution interrupted: run timed out after 15m of inactivity"
        meta["reconciliation"] = reason
        meta["error"] = "Run timed out: no heartbeat or progress update received"
        meta["interrupted"] = True
        run.metadata_json = meta
        await write_audit(
            session,
            workspace_id=run.workspace_id,
            user_id=None,
            action="run.interrupted",
            resource_type="run",
            resource_id=run.id,
            metadata={"reason": reason},
        )
        if commit:
            await session.commit()
        return True
    return False


@router.get("/runs", response_model=Page[RunListItem])
async def list_runs(
    project_id: str = Query(alias="projectId"),
    status_: RunStatus | None = Query(default=None, alias="status"),
    branch: str | None = Query(default=None),
    env: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> Page[RunListItem]:
    """List a project's runs with filters; 404 when the project is cross-workspace."""
    if not await _project_in_scope(session, project_id, ctx.workspace_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="project not found")
    decoded = decode_cursor_or_400(cursor)
    rows, next_keyset = await RunRepo(session).list_by_project(
        project_id, status=status_, branch=branch, env=env, cursor=decoded, limit=limit
    )
    items: list[RunListItem] = []
    reconciled_any = False
    now = datetime.now(UTC)
    cutoff = timedelta(minutes=15)
    for r in rows:
        if r.status == RunStatus.RUNNING:
            last_activity = r.updated_at or r.started_at or r.created_at
            if last_activity:
                last_act_utc = (
                    last_activity
                    if last_activity.tzinfo is not None
                    else last_activity.replace(tzinfo=UTC)
                )
                if now - last_act_utc > cutoff and await _reconcile_lazy_interrupted_run(
                    session, r, commit=False
                ):
                    reconciled_any = True
        item = RunListItem.model_validate(r)
        item.summary = RunSummary(
            total_steps=r.total_steps,
            passed_steps=r.passed_steps,
            failed_steps=r.failed_steps,
            duration_ms=r.duration_ms,
        )
        items.append(item)
    if reconciled_any:
        await session.commit()
    return Page[RunListItem](
        items=items,
        meta=PageMeta(next_cursor=encode_next(next_keyset), limit=limit),
    )


@router.get("/runs/summary", response_model=RunsSummary)
async def get_runs_summary(
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> RunsSummary:
    """Aggregated counters for the Runs dashboard summary bar (docs/API.md §3.5).

    Counts are workspace-scoped (joined via ``projects``). ``failed`` folds
    ``FAIL`` + ``ERROR`` + ``INTERRUPTED`` together to match the Runs UI's binary outcome card.
    Static endpoint declared BEFORE the dynamic ``/runs/{run_id}`` route below
    so FastAPI's path matcher doesn't try to treat ``summary`` as a run id.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=15)
    stale_runs = (
        await session.scalars(
            select(Run).where(
                Run.workspace_id == ctx.workspace_id,
                Run.status == RunStatus.RUNNING,
                func.coalesce(Run.updated_at, Run.started_at, Run.created_at) < cutoff,
            )
        )
    ).all()
    if stale_runs:
        for stale_run in stale_runs:
            await _reconcile_lazy_interrupted_run(session, stale_run, commit=False)
        await session.commit()

    counts = await RunRepo(session).summary_for_workspace(ctx.workspace_id)
    interrupted_count = counts.get(RunStatus.INTERRUPTED.value, 0)
    return RunsSummary(
        active=counts.get(RunStatus.RUNNING.value, 0),
        today=counts.get("today", 0),
        passed=counts.get(RunStatus.PASS.value, 0),
        failed=counts.get(RunStatus.FAIL.value, 0)
        + counts.get(RunStatus.ERROR.value, 0)
        + interrupted_count,
        avg_duration_ms=counts.get("avg_duration_ms", 0),
        queued=counts.get(RunStatus.QUEUED.value, 0),
        interrupted=interrupted_count,
    )


def _extract_run_error_message(
    run: Run,
    summary: DbRunSummary,
    metadata_dict: dict[str, Any],
) -> str | None:
    raw = str(
        metadata_dict.get("error")
        or metadata_dict.get("error_message")
        or metadata_dict.get("interrupted_reason")
        or metadata_dict.get("reconciliation")
        or ""
    ).strip()
    if raw:
        return raw
    if run.status == RunStatus.ERROR and summary.total_steps == 0:
        return "Cannot execute run: selected test cases contain no steps"
    return None


def _extract_snapshot_cases(snapshot_cases: list[Any]) -> list[RunCaseSummary]:
    cases: list[RunCaseSummary] = []
    for item in snapshot_cases:
        if isinstance(item, dict):
            cases.append(
                RunCaseSummary(
                    case_id=str(item.get("case_id", "")),
                    case_public_id=str(item.get("case_public_id", "")),
                    case_title=str(item.get("case_title", "")),
                    total_steps=int(item.get("total_steps") or 0),
                )
            )
    return cases


@router.get("/runs/{run_id}", response_model=RunDetail)
async def get_run(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> RunDetail:
    """Return a run with a step-outcome summary; 404 when cross-workspace.

    Accepts the internal id OR the per-workspace ``public_id`` (e.g. ``R-1004``)
    that the web routes on.
    """
    repo = RunRepo(session)
    resolved = await repo.resolve_id(run_id, ctx.workspace_id)
    pair = await repo.get_with_summary(resolved) if resolved is not None else None
    if pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    run, summary = pair
    if not await _project_in_scope(session, run.project_id, ctx.workspace_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    steps = list((await session.scalars(select(RunStep).where(RunStep.run_id == run.id))).all())
    if await _reconcile_lazy_interrupted_run(session, run, steps):
        summary.duration_ms = run.duration_ms
    metadata = run.metadata_json or {}
    metadata_dict = metadata if isinstance(metadata, dict) else {}

    coverage = metadata_dict.get("coverageSummary")
    raw_selection = metadata_dict.get("selection")
    planned_cases: list[RunCaseSummary] = []
    snapshot_cases = metadata_dict.get("planned_cases")
    if isinstance(snapshot_cases, list) and snapshot_cases:
        planned_cases = _extract_snapshot_cases(snapshot_cases)
    elif isinstance(raw_selection, list) and raw_selection:
        case_ids = [
            item["case_id"]
            for item in raw_selection
            if isinstance(item, dict) and isinstance(item.get("case_id"), str)
        ]
        if case_ids:
            tc_rows = (
                await session.execute(
                    select(
                        TestCase.id,
                        TestCase.public_id,
                        TestCase.title,
                        func.count(TestStep.id),
                    )
                    .outerjoin(TestStep, TestStep.case_id == TestCase.id)
                    .where(TestCase.id.in_(case_ids))
                    .group_by(TestCase.id, TestCase.public_id, TestCase.title)
                )
            ).all()
            tc_map = {row[0]: (row[1], row[2], int(row[3] or 0)) for row in tc_rows}

            # For legacy completed runs without snapshot, query executed steps count
            # so historical PASS runs never report unexecuted steps when cases are edited later.
            run_step_counts = (
                await session.execute(
                    select(RunStep.case_id, func.count(RunStep.id))
                    .where(RunStep.run_id == run.id)
                    .group_by(RunStep.case_id)
                )
            ).all()
            executed_map = {row[0]: int(row[1] or 0) for row in run_step_counts}

            for cid in case_ids:
                if cid in tc_map:
                    pid, title, step_count = tc_map[cid]
                    if run.status == RunStatus.PASS and executed_map.get(cid, 0) > 0:
                        step_count = executed_map[cid]
                    planned_cases.append(
                        RunCaseSummary(
                            case_id=cid,
                            case_public_id=pid,
                            case_title=title,
                            total_steps=step_count,
                        )
                    )

    return RunDetail(
        id=run.id,
        public_id=run.public_id,
        project_id=run.project_id,
        name=run.name,
        branch=run.branch,
        commit_sha=run.commit_sha,
        env=run.env,
        trigger=run.trigger,
        status=run.status,
        started_at=run.started_at,
        completed_at=run.completed_at,
        duration_ms=run.duration_ms,
        created_at=run.created_at,
        updated_at=run.updated_at,
        summary=RunSummary(
            total_steps=summary.total_steps,
            passed_steps=summary.passed_steps,
            failed_steps=summary.failed_steps,
            duration_ms=summary.duration_ms,
        ),
        coverage_summary=coverage if isinstance(coverage, dict) else None,
        cases=planned_cases,
        playwright_config=PlaywrightConfig.model_validate(metadata_dict["playwright_config"])
        if "playwright_config" in metadata_dict
        and isinstance(metadata_dict["playwright_config"], dict)
        else None,
        error_message=_extract_run_error_message(run, summary, metadata_dict),
    )


#: A step's output rides along in the list response, so it is capped: a tree
#: dump can run to megabytes, and the whole thing belongs in the log stream
#: rather than in every row of a run's step table.
_MAX_STEP_OUTPUT = 8000


def _step_output(stdout: str | None) -> str | None:
    if not stdout:
        return None
    if len(stdout) <= _MAX_STEP_OUTPUT:
        return stdout
    return stdout[:_MAX_STEP_OUTPUT] + "\n… truncated; see the run log for the rest"


@router.get("/runs/{run_id}/steps", response_model=list[RunStepPublic])
async def get_run_steps(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> list[RunStepPublic]:
    """Return a run's steps (ordered) with outcomes + case public ids; 404 if cross-ws."""
    run_id = await _run_in_scope_or_404(session, run_id, ctx.workspace_id)
    rows = await RunRepo(session).get_steps_with_case_public_id(run_id)

    # Check if any step lacks an action title in its state_snapshot
    missing_action_case_ids: set[str] = set()
    for step, _pub_id, _name, _title in rows:
        snap = step.state_snapshot if isinstance(step.state_snapshot, dict) else {}
        if not (snap.get("action") or snap.get("description") or snap.get("title")):
            missing_action_case_ids.add(step.case_id)

    fallback_actions_by_case: dict[str, list[str]] = {}
    if missing_action_case_ids:
        tc_steps_stmt = (
            select(TestStep.case_id, TestStep.action)
            .where(TestStep.case_id.in_(missing_action_case_ids))
            .order_by(TestStep.case_id, TestStep.order.asc())
        )
        tc_steps_rows = (await session.execute(tc_steps_stmt)).all()
        for cid, action in tc_steps_rows:
            fallback_actions_by_case.setdefault(cid, []).append(action)

    case_step_indices: dict[str, int] = {}
    out: list[RunStepPublic] = []
    for step, public_id, name, case_title in rows:
        snap = step.state_snapshot if isinstance(step.state_snapshot, dict) else {}
        idx_in_case = case_step_indices.get(step.case_id, 0)
        case_step_indices[step.case_id] = idx_in_case + 1

        action_title = str(
            snap.get("action") or snap.get("description") or snap.get("title") or ""
        ).strip()
        if not action_title and step.case_id in fallback_actions_by_case:
            actions_list = fallback_actions_by_case[step.case_id]
            if idx_in_case < len(actions_list):
                action_title = actions_list[idx_in_case]

        out.append(
            RunStepPublic(
                id=step.id,
                run_id=step.run_id,
                case_id=step.case_id,
                case_public_id=public_id,
                case_name=name or "",
                case_title=case_title or "",
                step_order=step.step_order,
                outcome=step.outcome,
                title=action_title,
                type=str(snap.get("type") or "action"),
                started_at=step.started_at,
                completed_at=step.completed_at,
                duration_ms=step.duration_ms,
                error_message=step.error_message,
                stdout=_step_output(step.stdout),
            )
        )
    return out


@router.get("/runs/{run_id}/report.junit", response_class=Response)
async def get_run_junit_report(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    """Render a run as a JUnit XML report for CI consumption (Jenkins / GHA).

    Deterministic and LLM-free: each test case becomes one ``<testcase>`` rolled up
    from its run steps (error > failure > skipped > passed). 404 when cross-workspace.
    Returned as ``application/xml`` so a CI job can pipe it into its test reporter.
    """
    repo = RunRepo(session)
    resolved = await repo.resolve_id(run_id, ctx.workspace_id)
    pair = await repo.get_with_summary(resolved) if resolved is not None else None
    if pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    run, _ = pair
    if not await _project_in_scope(session, run.project_id, ctx.workspace_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    steps = await repo.get_steps_with_case_public_id(run.id)
    xml = render_junit(
        run.name, [(step, public_id) for step, public_id, _name, _title, *_ in steps]
    )
    return Response(content=xml, media_type="application/xml")


@router.get("/runs/{run_id}/replay", response_model=RunReplayResponse)
async def get_run_replay(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> RunReplayResponse:
    """Time-travel replay: ordered steps + per-step state delta (M5-1).

    Deterministic and LLM-free — the delta is a pure JSON diff between each step's
    captured ``state_snapshot`` (normalized MCP output) and the previous step's.
    The first step has an empty delta (no prior state). 404 when cross-workspace.
    """
    run_id = await _run_in_scope_or_404(session, run_id, ctx.workspace_id)
    pairs = await RunRepo(session).get_steps_with_case_public_id(run_id)
    replay_steps: list[RunReplayStep] = []
    prev_snapshot: dict[str, object] | None = None
    for step, public_id, _case_name, _case_title, *_ in pairs:
        snapshot = step.state_snapshot
        delta = compute_state_delta(prev_snapshot, snapshot)
        replay_steps.append(
            RunReplayStep(
                id=step.id,
                step_order=step.step_order,
                case_public_id=public_id,
                outcome=step.outcome,
                duration_ms=step.duration_ms,
                started_at=step.started_at,
                error_message=step.error_message,
                state_snapshot=snapshot,
                delta=_public_state_changes(delta),
            )
        )
        prev_snapshot = snapshot
    return RunReplayResponse(run_id=run_id, steps=replay_steps)


@router.get("/runs/{run_id}/logs", response_model=RunLogPage)
async def get_run_logs(
    run_id: str,
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> RunLogPage:
    """Cursor-paginated slice of the orchestrator's persisted log stream (M1c).

    ``cursor`` is the last ``seq`` the client has already seen — pass ``0`` to
    fetch the head of the stream. Returns up to ``limit`` rows ordered ascending
    by ``seq`` plus the next ``seq`` for follow-up paging and a boolean
    ``hasMore`` so the FE knows when to stop polling. A request that returns
    fewer rows than ``limit`` is the natural EOF marker.
    """
    run_id = await _run_in_scope_or_404(session, run_id, ctx.workspace_id)
    rows = await RunStepLogRepo(session).list_after(run_id, cursor=cursor, limit=limit)
    items = [
        RunLogItem(seq=r.seq, level=r.level, message=r.message, created_at=r.created_at)
        for r in rows
    ]
    next_cursor = rows[-1].seq if rows else cursor
    return RunLogPage(items=items, next_cursor=next_cursor, has_more=len(rows) == limit)


@router.get("/runs/{run_id}/artifacts", response_model=list[ArtifactPublic])
async def get_run_artifacts(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> list[ArtifactPublic]:
    """List a run's artifacts; 404 when the run is cross-workspace."""
    run_id = await _run_in_scope_or_404(session, run_id, ctx.workspace_id)
    rows = await RunRepo(session).get_artifacts(run_id)
    return [ArtifactPublic.model_validate(r) for r in rows]


_ARTIFACT_SIGNED_URL_TTL_SECONDS = 3600

_SAFE_INLINE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "video/webm",
    "video/mp4",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
    "text/plain",
}


def _safe_filename(url_or_name: str) -> str:
    unquoted = unquote(url_or_name)
    base = unquoted.replace("\\", "/").split("/")[-1].split("?")[0]
    cleaned = "".join(c for c in base if c.isascii() and (c.isalnum() or c in "._- "))
    cleaned = cleaned.strip()[:128]
    return cleaned or "artifact"


def _parse_http_range(range_header: str | None, file_size: int) -> tuple[int, int] | None:
    """Parse HTTP Range header (bytes=start-end).

    Returns (start, end) inclusive, or None if no valid/supported range requested.
    Raises HTTPException(416) if range is unsatisfiable or multipart.
    """
    if not range_header or file_size <= 0:
        return None
    range_str = range_header.strip()
    if len(range_str) > 512:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Range header too long",
        )
    prefix, sep, val = range_str.partition("=")
    if not sep or prefix.strip().lower() != "bytes":
        return None
    val = val.strip()
    if "," in val:
        # Multipart ranges rejected to protect against DoS
        raise HTTPException(
            status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    parts = val.split("-", 1)
    if len(parts) != 2:
        return None
    start_str, end_str = parts[0].strip(), parts[1].strip()

    if not start_str and not end_str:
        return None

    try:
        if not start_str:
            # Suffix range: bytes=-200
            suffix = int(end_str)
            if suffix <= 0 or file_size == 0:
                raise HTTPException(
                    status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
                    headers={"Content-Range": f"bytes */{file_size}"},
                )
            start = max(0, file_size - suffix)
            end = file_size - 1
            return start, end
        elif not end_str:
            # Open-ended: bytes=500-
            start = int(start_str)
            if start < 0 or start >= file_size:
                raise HTTPException(
                    status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
                    headers={"Content-Range": f"bytes */{file_size}"},
                )
            return start, file_size - 1
        else:
            # Slice: bytes=0-499
            start = int(start_str)
            end = int(end_str)
            if start < 0 or start > end or start >= file_size:
                raise HTTPException(
                    status_code=status.HTTP_416_RANGE_NOT_SATISFIABLE,
                    headers={"Content-Range": f"bytes */{file_size}"},
                )
            end = min(end, file_size - 1)
            return start, end
    except ValueError:
        # Malformed integer (e.g. bytes=foo-bar): fallback to full content (200 OK)
        return None


async def _stream_file_range(
    path: Path, start: int, length: int, chunk_size: int = 64 * 1024
) -> AsyncIterator[bytes]:
    file = await anyio.open_file(path, "rb")
    try:
        await file.seek(start)
        remaining = length
        while remaining > 0:
            to_read = min(remaining, chunk_size)
            chunk = await file.read(to_read)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        await file.aclose()


_ALLOWED_S3_PREFIXES: tuple[str, ...] = ("runs/", "uploads/")


def _bounded_unquote(val: str, max_rounds: int = 5) -> str:
    """Unquote percent-encodings until stable or max_rounds reached to neutralize nested/double encoding."""
    curr = val
    for _ in range(max_rounds):
        next_val = unquote(curr)
        if next_val == curr:
            break
        curr = next_val
    return curr


def _validate_s3_location(artifact_url: str) -> tuple[str, str]:
    """Validate S3 artifact URL, bound unquoting, enforce prefix containment and anti-traversal.

    Returns: (bucket, key)
    Raises: HTTPException(400) or HTTPException(403)
    """
    settings = get_settings()
    s3_path = artifact_url.removeprefix("s3://")
    if "/" not in s3_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid s3 url")
    bucket, raw_key = s3_path.split("/", 1)
    if bucket != settings.s3_bucket:
        _log.warning(
            "artifact.access_rejected: external bucket %s forbidden (expected %s)",
            bucket,
            settings.s3_bucket,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="access to external bucket forbidden",
        )

    unquoted_key = _bounded_unquote(raw_key).replace("\\", "/")
    normalized_key = raw_key.replace("\\", "/")

    if (
        not raw_key
        or not raw_key.strip()
        or ".." in normalized_key
        or ".." in unquoted_key
        or "\x00" in raw_key
        or "\x00" in unquoted_key
        or "%00" in raw_key
        or normalized_key.startswith("/")
        or unquoted_key.startswith("/")
    ):
        _log.warning(
            "artifact.access_rejected: path traversal or invalid key blocked (key=%r)",
            raw_key,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid key path",
        )

    # Prefix containment: key must start with an approved prefix (e.g. runs/, uploads/)
    clean_key = unquoted_key.lstrip("/")
    if not any(clean_key.startswith(prefix) for prefix in _ALLOWED_S3_PREFIXES):
        _log.warning(
            "artifact.access_rejected: key %r does not start with an allowed prefix %r",
            raw_key,
            _ALLOWED_S3_PREFIXES,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid key path",
        )

    return bucket, raw_key


@router.get("/runs/{run_id}/artifacts/{artifact_id}", response_model=ArtifactSignedUrl)
async def get_artifact_signed_url(
    run_id: str,
    artifact_id: str,
    ctx: TenantContext = Depends(tenant_via_api_key_or_session),
    session: AsyncSession = Depends(get_async_session),
) -> ArtifactSignedUrl:
    """Return a real S3/MinIO presigned download URL or streaming gateway URL for one artifact."""
    run_id = await _run_in_scope_or_404(session, run_id, ctx.workspace_id)
    repo = RunRepo(session)
    artifacts = await repo.get_artifacts(run_id)
    artifact = next((a for a in artifacts if a.id == artifact_id), None)
    if artifact is None or not artifact.url.startswith(("s3://", "local://")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")

    if artifact.url.startswith("local://"):
        return ArtifactSignedUrl(
            url=f"/api/v1/runs/{run_id}/artifacts/{artifact_id}/raw?workspaceId={ctx.workspace_id}",
            expires_in_seconds=0,
            kind=artifact.kind,
            mime_type=artifact.mime_type,
        )

    settings = get_settings()
    bucket, key = _validate_s3_location(artifact.url)

    use_gateway = settings.s3_force_gateway or (
        not settings.s3_public_endpoint and is_internal_s3_endpoint(settings.s3_endpoint)
    )

    if use_gateway:
        now = int(time.time())
        expires_at = now + _ARTIFACT_SIGNED_URL_TTL_SECONDS
        token = create_media_token(run_id, artifact_id, ctx.workspace_id, expires_at)
        url = (
            f"/api/v1/runs/{run_id}/artifacts/{artifact_id}/raw"
            f"?workspaceId={ctx.workspace_id}&token={token}&expires={expires_at}"
        )
    else:
        url = await presign_s3_get(
            bucket,
            key,
            expires_in=_ARTIFACT_SIGNED_URL_TTL_SECONDS,
        )

    await write_audit(
        session,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        action="artifact.signed_url",
        resource_type="artifact",
        resource_id=artifact.id,
        metadata={"run_id": run_id},
    )
    await session.commit()
    return ArtifactSignedUrl(
        url=url,
        expires_in_seconds=_ARTIFACT_SIGNED_URL_TTL_SECONDS,
        kind=artifact.kind,
        mime_type=artifact.mime_type,
    )


async def _authenticate_raw_request(
    request: Request,
    run_id: str,
    artifact_id: str,
    workspace_id: str | None,
    token: str | None,
    expires: int | None,
    user: User | None,
    session: AsyncSession,
) -> str:
    """Authenticate via HMAC media token OR active session/API key; returns resolved workspace_id."""
    if token:
        candidate_ws = workspace_id or request.headers.get("X-Workspace-Id")
        if not candidate_ws:
            _log.warning(
                "artifact.access_rejected: workspace not specified for media token (run_id=%s, artifact_id=%s)",
                run_id,
                artifact_id,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="workspace not specified",
            )
        if not verify_media_token(token, run_id, artifact_id, candidate_ws, expires_at=expires):
            _log.warning(
                "artifact.access_rejected: invalid or expired media token (run_id=%s, artifact_id=%s, ws=%s)",
                run_id,
                artifact_id,
                candidate_ws,
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid or expired media token",
            )
        return candidate_ws

    ctx = await tenant_via_api_key_or_session(
        request=request,
        session=session,
        x_workspace_id=request.headers.get("X-Workspace-Id"),
        x_api_key=request.headers.get("X-API-Key"),
        user=user,
    )
    return ctx.workspace_id


async def _resolve_artifact_meta_and_source(
    artifact: Artifact,
) -> tuple[int, str, str | None, Path | None, str, str]:
    """Validate artifact scheme, enforce anti-SSRF/path-traversal, and fetch metadata.

    Returns: (file_size, mime_type, etag, local_path, s3_bucket, s3_key)
    """
    settings = get_settings()
    if artifact.url.startswith("s3://"):
        bucket, key = _validate_s3_location(artifact.url)
        try:
            meta_size, meta_mime, s3_etag = await get_s3_object_meta(bucket, key)
        except HTTPException:
            raise
        except Exception as exc:
            err_code = ""
            if hasattr(exc, "response") and isinstance(exc.response, dict):
                err_code = str(exc.response.get("Error", {}).get("Code", ""))
            if err_code in ("404", "NoSuchKey", "NotFound"):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="artifact not found in storage",
                ) from exc
            _log.error(
                "artifact.storage_error: failed to fetch metadata for %s/%s: %s",
                bucket,
                key,
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="storage backend unavailable",
            ) from exc

        file_size = meta_size
        mime_type = artifact.mime_type or meta_mime or "application/octet-stream"
        etag = s3_etag or f"{artifact.id}-{file_size}"
        return file_size, mime_type, etag, None, bucket, key

    if artifact.url.startswith("local://"):
        root = Path(settings.artifacts_dir).resolve()  # noqa: ASYNC240 — metadata-only, local FS
        local_rel = artifact.url.removeprefix("local://")
        unquoted_local = _bounded_unquote(local_rel).replace("\\", "/")
        normalized_local = local_rel.replace("\\", "/")
        if (
            ".." in normalized_local
            or ".." in unquoted_local
            or "\x00" in normalized_local
            or "\x00" in unquoted_local
            or "%00" in normalized_local
        ):
            _log.warning(
                "artifact.access_rejected: local path traversal attempted in %r",
                artifact.url,
            )
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")
        path = (root / unquoted_local).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="artifact not found",
            )
        stat = path.stat()
        mime = artifact.mime_type or "application/octet-stream"
        return stat.st_size, mime, f"{stat.st_mtime_ns}-{stat.st_size}", path, "", ""

    if artifact.url.startswith("file://"):
        root = Path(settings.artifacts_dir).resolve()  # noqa: ASYNC240 — metadata-only, local FS
        raw_path = artifact.url.removeprefix("file://")
        unquoted_raw = _bounded_unquote(raw_path)
        if "\x00" in raw_path or "\x00" in unquoted_raw or "%00" in raw_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid file path")
        path = Path(unquoted_raw).resolve()  # noqa: ASYNC240 — metadata-only, local FS
        if not path.is_relative_to(root) or not path.is_file():
            _log.warning(
                "artifact.access_rejected: file path %r outside artifacts_dir %r",
                unquoted_raw,
                str(root),
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="artifact not found",
            )
        stat = path.stat()
        mime = artifact.mime_type or "application/octet-stream"
        return stat.st_size, mime, f"{stat.st_mtime_ns}-{stat.st_size}", path, "", ""

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unsupported artifact scheme")


def _check_if_none_match(request: Request, etag: str | None) -> Response | None:
    if_none_match = request.headers.get("if-none-match")
    if not (if_none_match and etag):
        return None
    normalized_server = etag.strip().strip('"').removeprefix("W/")
    client_etags = {
        t.strip().strip('"').removeprefix("W/") for t in if_none_match.split(",") if t.strip()
    }
    if "*" in client_etags or normalized_server in client_etags:
        return Response(
            status_code=status.HTTP_304_NOT_MODIFIED,
            headers={"ETag": f'"{normalized_server}"'},
        )
    return None


def _build_raw_headers(
    artifact_url: str,
    mime_type: str,
    etag: str | None,
    download: bool,
    is_terminal: bool = False,
) -> dict[str, str]:
    ascii_filename = _safe_filename(artifact_url)
    unquoted = (
        unquote(artifact_url).replace("\\", "/").split("/")[-1].split("?")[0].strip() or "artifact"
    )
    rfc5987_filename = quote(unquoted, safe=".-_")
    mime_lower = mime_type.lower()
    disposition_type = (
        "attachment" if (download or mime_lower not in _SAFE_INLINE_MIME_TYPES) else "inline"
    )
    disposition = (
        f"{disposition_type}; filename=\"{ascii_filename}\"; filename*=UTF-8''{rfc5987_filename}"
    )

    if mime_lower in _SAFE_INLINE_MIME_TYPES and not download:
        if mime_lower.startswith(("video/", "audio/")):
            csp = "default-src 'none'; media-src 'self' blob:; style-src 'unsafe-inline'"
        elif mime_lower.startswith("image/"):
            csp = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
        else:
            csp = "default-src 'none'; style-src 'unsafe-inline'"
    else:
        csp = "default-src 'none'; sandbox"

    cache_control = "private, max-age=86400, immutable" if is_terminal else "private, max-age=3600"

    headers = {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, ETag",
        "Accept-Ranges": "bytes",
        "Content-Disposition": disposition,
        "Cache-Control": cache_control,
    }
    if etag:
        headers["ETag"] = f'"{etag.strip()}"'
    return headers


def _stream_artifact_payload(
    request: Request,
    artifact_url: str,
    mime_type: str,
    headers: dict[str, str],
    file_size: int,
    byte_range: tuple[int, int] | None,
    path: Path | None,
    bucket: str,
    key: str,
) -> Response:
    if byte_range is not None:
        start_byte, end_byte = byte_range
        content_length = end_byte - start_byte + 1
        range_headers = {
            **headers,
            "Content-Range": f"bytes {start_byte}-{end_byte}/{file_size}",
            "Content-Length": str(content_length),
        }
        if request.method == "HEAD":
            return Response(
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                media_type=mime_type,
                headers=range_headers,
            )
        if artifact_url.startswith("s3://"):
            stream = stream_s3_artifact(bucket, key, start_byte=start_byte, end_byte=end_byte)
            return StreamingResponse(
                stream,
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                media_type=mime_type,
                headers=range_headers,
            )
        if path is not None:
            stream = _stream_file_range(path, start=start_byte, length=content_length)
            return StreamingResponse(
                stream,
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                media_type=mime_type,
                headers=range_headers,
            )

    resp_headers = {**headers, "Content-Length": str(file_size)}
    if request.method == "HEAD":
        return Response(status_code=status.HTTP_200_OK, media_type=mime_type, headers=resp_headers)
    if artifact_url.startswith("s3://"):
        stream = stream_s3_artifact(bucket, key)
        return StreamingResponse(
            stream, status_code=status.HTTP_200_OK, media_type=mime_type, headers=resp_headers
        )
    if path is not None:
        return FileResponse(path, media_type=mime_type, headers=headers)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact not found")


@router.get(
    "/runs/{run_id}/artifacts/{artifact_id}/raw",
    operation_id="get_artifact_raw",
)
async def get_artifact_raw(
    request: Request,
    run_id: str,
    artifact_id: str,
    workspaceId: str | None = Query(default=None),
    token: str | None = Query(default=None),
    expires: int | None = Query(default=None),
    download: bool = Query(default=False),
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    """Stream one artifact (s3://, local://, file://) with dual-auth, range requests, ETag, and MIME sanitization."""
    return await _handle_artifact_raw(
        request=request,
        run_id=run_id,
        artifact_id=artifact_id,
        workspaceId=workspaceId,
        token=token,
        expires=expires,
        download=download,
        user=user,
        session=session,
    )


@router.head(
    "/runs/{run_id}/artifacts/{artifact_id}/raw",
    operation_id="head_artifact_raw",
)
async def head_artifact_raw(
    request: Request,
    run_id: str,
    artifact_id: str,
    workspaceId: str | None = Query(default=None),
    token: str | None = Query(default=None),
    expires: int | None = Query(default=None),
    download: bool = Query(default=False),
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    """Retrieve metadata headers for one artifact without downloading the payload body."""
    return await _handle_artifact_raw(
        request=request,
        run_id=run_id,
        artifact_id=artifact_id,
        workspaceId=workspaceId,
        token=token,
        expires=expires,
        download=download,
        user=user,
        session=session,
    )


async def _handle_artifact_raw(
    request: Request,
    run_id: str,
    artifact_id: str,
    workspaceId: str | None = Query(default=None),
    token: str | None = Query(default=None),
    expires: int | None = Query(default=None),
    download: bool = Query(default=False),
    user: User | None = Depends(current_active_user_optional),
    session: AsyncSession = Depends(get_async_session),
) -> Response:
    """Stream one artifact (s3://, local://, file://) with dual-auth, range requests, ETag, and MIME sanitization."""
    resolved_ws_id = await _authenticate_raw_request(
        request, run_id, artifact_id, workspaceId, token, expires, user, session
    )

    run_db_id = await _run_in_scope_or_404(session, run_id, resolved_ws_id)
    repo = RunRepo(session)
    run = await repo.get_by_id(run_db_id)
    is_terminal = bool(
        run is not None
        and run.status
        in {
            RunStatus.PASS,
            RunStatus.FAIL,
            RunStatus.ERROR,
            RunStatus.CANCELLED,
            RunStatus.INTERRUPTED,
        }
    )

    artifacts = await repo.get_artifacts(run_db_id)
    artifact = next((a for a in artifacts if a.id == artifact_id), None)
    if artifact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="artifact not found",
        )

    file_size, mime_type, etag, path, bucket, key = await _resolve_artifact_meta_and_source(
        artifact
    )

    cached_resp = _check_if_none_match(request, etag)
    if cached_resp is not None:
        return cached_resp

    if token:
        await write_audit(
            session,
            workspace_id=resolved_ws_id,
            user_id=None,
            action="artifact.stream",
            resource_type="artifact",
            resource_id=artifact.id,
            metadata={"run_id": run_id, "token_auth": True, "method": request.method},
        )
        await session.commit()

    base_headers = _build_raw_headers(
        artifact.url, mime_type, etag, download, is_terminal=is_terminal
    )

    range_header = request.headers.get("range")
    byte_range = _parse_http_range(range_header, file_size)

    # RFC 9110 Section 13.1.8: If-Range conditional evaluation
    if_range = request.headers.get("if-range")
    if byte_range is not None and if_range and etag:
        norm_if_range = if_range.strip().strip('"').removeprefix("W/")
        norm_etag = etag.strip().strip('"').removeprefix("W/")
        if norm_if_range != norm_etag:
            # Representation changed: ignore Range header and serve full content (200 OK)
            byte_range = None

    return _stream_artifact_payload(
        request=request,
        artifact_url=artifact.url,
        mime_type=mime_type,
        headers=base_headers,
        file_size=file_size,
        byte_range=byte_range,
        path=path,
        bucket=bucket,
        key=key,
    )


@router.get("/runs/{run_id}/network", response_model=RunNetworkResponse)
async def get_run_network(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
) -> RunNetworkResponse:
    """Network events captured during the run (M1b stub).

    Validates run-in-workspace scope (404 cross-workspace) and returns an empty
    page — HAR-driven event extraction lands with the runner in M1c. Frontend
    Network tab already renders the empty state today, so wiring this stub now
    means the screen stops 404-ing in real dev.
    """
    run_id = await _run_in_scope_or_404(session, run_id, ctx.workspace_id)
    return RunNetworkResponse(items=[])


def _build_run_service(session: AsyncSession, ctx: TenantContext) -> RunService:
    """Compose a :class:`RunService` from a session + the resolved tenant scope.

    Both repos are workspace-aware via the service's ``_project_in_scope`` guard;
    the helper exists so the create / cancel / rerun handlers below stay one-liners
    and the next M1d endpoint added on top doesn't have to re-derive the wiring.
    """
    return RunService(ctx, RunRepo(session), ProjectRepo(session))


@router.post("/runs", response_model=RunPublic, status_code=status.HTTP_202_ACCEPTED)
async def create_run(
    body: CreateRunBody,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
    arq: ArqRedis | None = Depends(get_arq),
) -> RunPublic:
    """Validate selection + MCP routing, persist the run, enqueue the ARQ job.

    Returns 202 once the row exists and the job has been enqueued — the runner
    flips the status to ``RUNNING`` / ``PASS`` / ``FAIL`` asynchronously. The
    metadata blob carries the original selection so a rerun (or the orchestrator
    on resume) can rehydrate it without re-deriving suite ordering.
    """
    svc = _build_run_service(session, ctx)
    playwright_cfg = (
        body.playwright_config.model_dump(by_alias=False)
        if body.playwright_config is not None
        else None
    )
    try:
        run = await svc.create_run(
            project_id=body.project_id,
            name=body.name,
            selection=[item.model_dump(by_alias=False) for item in body.selection],
            branch=body.branch,
            commit_sha=body.commit_sha,
            env=body.env,
            trigger=body.trigger,
            user_id=ctx.user_id,
            mcp_routing_override=body.mcp_routing_override,
            playwright_config=playwright_cfg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    job_id = await dispatch_run(
        mode=get_settings().mode, arq=arq, run_id=run.id, queue_name=_RUNS_QUEUE
    )
    if job_id is not None:
        await svc.attach_arq_job_id(run.id, job_id)
    await session.commit()
    await session.refresh(run)
    return RunPublic.model_validate(run)


@router.post(
    "/suites/{suite_id}/run", response_model=RunPublic, status_code=status.HTTP_202_ACCEPTED
)
async def create_suite_run(
    suite_id: str,
    body: CreateSuiteRunBody,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
    arq: ArqRedis | None = Depends(get_arq),
) -> RunPublic:
    """Run every active case in a suite as ONE bundle run, then enqueue the ARQ job.

    QA "run smoke/regression suite" entry point: the selection is derived
    server-side from the suite's active cases (in suite order), so the caller only
    sends run metadata. Returns 202 like ``POST /runs``. 400 when the suite is
    cross-workspace ("suite not found") or empty ("suite has no active cases").
    """
    svc = _build_run_service(session, ctx)
    playwright_cfg = (
        body.playwright_config.model_dump(by_alias=False)
        if body.playwright_config is not None
        else None
    )
    try:
        run = await svc.create_run_for_suite(
            suite_id=suite_id,
            name=body.name,
            branch=body.branch,
            commit_sha=body.commit_sha,
            env=body.env,
            trigger=body.trigger,
            user_id=ctx.user_id,
            mcp_routing_override=body.mcp_routing_override,
            playwright_config=playwright_cfg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    job_id = await dispatch_run(
        mode=get_settings().mode, arq=arq, run_id=run.id, queue_name=_RUNS_QUEUE
    )
    if job_id is not None:
        await svc.attach_arq_job_id(run.id, job_id)
    await session.commit()
    await session.refresh(run)
    return RunPublic.model_validate(run)


# Statuses that ``POST /runs/:id/cancel`` will transition to CANCELLED. Any
# other status (PASS / FAIL / ERROR / CANCELLED) is terminal and returns 409.
_CANCELLABLE_STATUSES: frozenset[RunStatus] = frozenset({RunStatus.QUEUED, RunStatus.RUNNING})


@router.post("/runs/{run_id}/cancel", response_model=RunPublic)
async def cancel_run(
    run_id: str,
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
    arq: ArqRedis | None = Depends(get_arq),
) -> RunPublic:
    """Transition a QUEUED / RUNNING run to CANCELLED and best-effort abort the ARQ job.

    The DB transition is authoritative — even if ARQ is unreachable, the run
    row flips to CANCELLED so the UI no longer shows it as live. We then try
    to abort the in-flight job (no-op if the job already completed / never
    started). Returns 409 when the run is already in a terminal state.
    """
    svc = _build_run_service(session, ctx)
    run = await svc.get(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    if run.status not in _CANCELLABLE_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="run not cancellable")
    metadata = run.metadata_json or {}
    job_id_raw = metadata.get("arq_job_id") if isinstance(metadata, dict) else None
    if isinstance(job_id_raw, str) and arq is not None:
        try:
            from arq.jobs import Job as ArqJob

            await ArqJob(job_id_raw, arq, _queue_name=_RUNS_QUEUE).abort()
        except Exception:
            pass
    updated = await svc.update_status(run_id, RunStatus.CANCELLED)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")
    await session.commit()
    await session.refresh(updated)
    return RunPublic.model_validate(updated)


@router.post("/runs/{run_id}/rerun", response_model=RunPublic, status_code=status.HTTP_202_ACCEPTED)
async def rerun_run(
    run_id: str,
    body: RerunRunBody | None = None,
    failed_only: bool = Query(default=False, alias="failedOnly"),
    ctx: TenantContext = Depends(require_workspace_membership),
    session: AsyncSession = Depends(get_async_session),
    arq: ArqRedis | None = Depends(get_arq),
) -> RunPublic:
    """Clone the source run's selection into a fresh QUEUED row + enqueue the ARQ job.

    Supports full rerun, selective rerun by ``case_ids`` (via JSON body), or
    failed-only rerun (via ``failedOnly=true`` query param or body). Returns 202.
    """
    svc = _build_run_service(session, ctx)
    src = await svc.get(run_id)
    if src is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")

    is_failed_only = failed_only or (body.failed_only if body else False)
    target_case_ids = body.case_ids if (body and body.case_ids is not None) else None
    target_pw_config = (
        body.playwright_config.model_dump(by_alias=False)
        if (body and body.playwright_config is not None)
        else None
    )

    try:
        new_run = await svc.clone_for_rerun(
            src,
            user_id=ctx.user_id,
            failed_only=is_failed_only,
            case_ids=target_case_ids,
            playwright_config=target_pw_config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    job_id = await dispatch_run(
        mode=get_settings().mode, arq=arq, run_id=new_run.id, queue_name=_RUNS_QUEUE
    )
    if job_id is not None:
        await svc.attach_arq_job_id(new_run.id, job_id)
    await session.commit()
    await session.refresh(new_run)
    return RunPublic.model_validate(new_run)
