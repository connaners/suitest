"""Tool executor for the agent conversation panel (M3-12 extension).

The chat panel's model can request tools by replying with
``{"tool": "<name>", "arguments": {...}}``. This module provides the registry
of tools the CONVERSATION panel may call, wired to real services:

Read-only (auto-executed):
    ``case.get``          — case metadata + steps, addressed by public id.
    ``cases.search``      — find cases by public id or title substring.
    ``project.overview``  — projects with suite / case counts and last run.
    ``suites.list``       — suites of a project with case counts.
    ``suite.get``         — one suite and its cases.
    ``runs.list``         — recent runs of a project.
    ``run.get``           — one run's status and step counters.

Mutating (surfaced to the user as a confirm card; executed only after an
explicit confirm round-trip carries ``execute: true``):
    ``case.update_meta``  — title / description / priority.
    ``case.set_steps``    — full ordered replace of the case's steps.
    ``run.trigger``       — run every active case of a suite.

Mutations re-use :class:`TestCaseService` / :class:`RunService`, so tenant
scoping, role checks, LLM readiness, validation, and audit logging all apply
unchanged.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from suitest_db.repositories.projects import ProjectRepo
from suitest_db.repositories.runs import RunRepo
from suitest_db.repositories.suites import SuiteRepo
from suitest_db.repositories.test_cases import TestCaseRepo
from suitest_shared.domain.enums import Priority, RunTrigger

if TYPE_CHECKING:
    from arq.connections import ArqRedis
    from sqlalchemy.ext.asyncio import AsyncSession
    from suitest_db.models.project import Project
    from suitest_db.models.run import Run

    from suitest_api.deps.scope import TenantContext
    from suitest_api.services.test_case_service import TestCaseService


class ToolDeniedError(Exception):
    """Raised when a mutation tool is invoked without a prior user confirm."""


class ToolInputError(Exception):
    """Raised when tool arguments fail validation; message is model-facing."""


class CaseGetArgs(BaseModel):
    case_id: str = Field(min_length=1, description="Public test case id, e.g. TC-1100")


class CasesSearchArgs(BaseModel):
    query: str = Field(min_length=1, description="Public id or title substring")


class ProjectOverviewArgs(BaseModel):
    project: str | None = Field(
        default=None, description="Project name, slug or id; omit for every project"
    )


class ProjectArgs(BaseModel):
    project: str = Field(min_length=1, description="Project name, slug or id")


class SuitesListArgs(ProjectArgs):
    query: str | None = Field(default=None, description="Suite name substring")


class SuiteGetArgs(BaseModel):
    suite_id: str = Field(min_length=1)


class RunsListArgs(ProjectArgs):
    limit: int = Field(default=10, ge=1, le=25)


class RunGetArgs(BaseModel):
    run_id: str = Field(min_length=1, description="Public run id, e.g. R-1001")


class RunTriggerArgs(BaseModel):
    suite_id: str = Field(min_length=1)
    env: str = Field(default="staging", min_length=1, max_length=32)


class CaseUpdateMetaArgs(BaseModel):
    case_id: str = Field(min_length=1)
    title: str | None = None
    description: str | None = None
    priority: Priority | None = None


class StepDraft(BaseModel):
    """One step the agent wants to write. ``action`` may be empty (a draft the
    user will fill in), mirroring ``StepAppend``."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid", populate_by_name=True)

    action: str = ""
    expected: str = ""
    code: str | None = None
    mcp_provider: str = Field(default="playwright-mcp", alias="mcpProvider")
    target_kind: str = Field(default="FE_WEB", alias="targetKind")
    order: int | None = Field(default=None, ge=0)


class CaseSetStepsArgs(BaseModel):
    case_id: str = Field(min_length=1)
    steps: list[StepDraft] = Field(min_length=1, max_length=100)


READ_TOOLS: dict[str, type[BaseModel]] = {
    "case.get": CaseGetArgs,
    "cases.search": CasesSearchArgs,
    "project.overview": ProjectOverviewArgs,
    "suites.list": SuitesListArgs,
    "suite.get": SuiteGetArgs,
    "runs.list": RunsListArgs,
    "run.get": RunGetArgs,
}
WRITE_TOOLS: dict[str, type[BaseModel]] = {
    "case.update_meta": CaseUpdateMetaArgs,
    "case.set_steps": CaseSetStepsArgs,
    "run.trigger": RunTriggerArgs,
}

# Compact description injected into the system prompt so the model knows what
# it can request and in which shape.
TOOLS_PROMPT = """
## Tools

Reply with prose, or with a single JSON object (and nothing else) to call a tool:
{"tool": "<name>", "arguments": {...}}

Read-only tools (executed immediately, result returned to you):
- case.get {"case_id": "TC-1100"} - case metadata + ordered steps.
- cases.search {"query": "login"} - match on public id or title.
- project.overview {"project"?: "omni"} - projects with suite/case counts and
  the last run; omit "project" to list every project.
- suites.list {"project": "omni", "query"?: "smoke"} - suites with case counts.
- suite.get {"suite_id": "<id from suites.list>"} - suite and its cases.
- runs.list {"project": "omni", "limit"?: 10} - most recent runs.
- run.get {"run_id": "R-1001"} - run status and step counters.

Mutating tools (the user sees a confirm card; your JSON alone does nothing):
- case.update_meta {"case_id": "TC-1100", "title"?: str, "description"?: str,
  "priority"?: "P0"|"P1"|"P2"|"P3"}
- case.set_steps {"case_id": "TC-1100", "steps": [{"action": str, "expected": str,
  "code"?: str|null, "mcpProvider"?: str, "targetKind"?: str, "order"?: int}, ...]}
- run.trigger {"suite_id": "<id from suites.list>", "env"?: "staging"} - run every
  active case in the suite; check progress later with run.get.

For step edits: call case.get first, then propose case.set_steps with the FULL
new step list (it replaces atomically). Keep every step's action non-empty.
"""


def _case_brief(detail: Any) -> dict[str, object]:
    """Compact, model-friendly projection of a TestCaseDetailOut-like object."""
    return {
        "public_id": detail.public_id,
        "title": detail.title,
        "description": detail.description,
        "priority": detail.priority,
        "status": detail.status,
        "steps": [
            {"order": s.order, "action": s.action, "expected": s.expected}
            for s in (detail.steps or [])
        ],
    }


async def execute_tool(
    tool: str,
    args: dict[str, object],
    *,
    session: AsyncSession,
    ctx: TenantContext,
    case_service: TestCaseService,
    confirmed: bool = False,
    arq: ArqRedis | None = None,
) -> dict[str, object]:
    """Execute an agent tool request.

    Read tools run immediately. Mutating tools raise :class:`ToolDeniedError`
    unless ``confirmed`` is true — the caller (SSE/WS layer) is responsible for
    surfacing the confirm card and re-invoking with the user's decision.
    """
    spec = READ_TOOLS.get(tool) or WRITE_TOOLS.get(tool)
    if spec is None:
        raise ToolInputError(f"unknown tool: {tool}")
    try:
        parsed: Any = spec.model_validate(args)
    except ValidationError as exc:
        raise ToolInputError(exc.json(indent=None)) from exc

    if tool == "case.get":
        return await _case_get(parsed, session=session, ctx=ctx)
    if tool == "cases.search":
        return await _cases_search(parsed, session=session, ctx=ctx)
    if tool == "project.overview":
        return await _project_overview(parsed, session=session, ctx=ctx)
    if tool == "suites.list":
        return await _suites_list(parsed, session=session, ctx=ctx)
    if tool == "suite.get":
        return await _suite_get(parsed, session=session, ctx=ctx)
    if tool == "runs.list":
        return await _runs_list(parsed, session=session, ctx=ctx)
    if tool == "run.get":
        return await _run_get(parsed, session=session, ctx=ctx)
    if tool == "run.trigger":
        if not confirmed:
            raise ToolDeniedError(tool)
        return await _run_trigger(parsed, session=session, ctx=ctx, arq=arq)
    if tool == "case.update_meta":
        if not confirmed:
            raise ToolDeniedError(tool)
        return await _case_update_meta(parsed, session=session, ctx=ctx, case_service=case_service)
    if tool == "case.set_steps":
        if not confirmed:
            raise ToolDeniedError(tool)
        return await _case_set_steps(parsed, session=session, ctx=ctx, case_service=case_service)
    raise ToolInputError(f"unhandled tool: {tool}")


# ---------------------------------------------------------------------------
# Read tools
# ---------------------------------------------------------------------------


async def _resolve_case(session: AsyncSession, ctx: TenantContext, case_id: str) -> tuple[Any, Any]:
    """Resolve a public or internal case id to (row, detail) or raise."""
    repo = TestCaseRepo(session)
    row = await repo.get_by_id(case_id) or await repo.get_by_public_id(case_id, ctx.workspace_id)
    if row is None:
        raise ToolInputError(f"case not found: {case_id}")
    suite = await SuiteRepo(session).get_by_id(row.suite_id)
    if suite is None:
        raise ToolInputError(f"case not found: {case_id}")
    project = await ProjectRepo(session).get_by_id(suite.project_id)
    if project is None or project.workspace_id != ctx.workspace_id:
        raise ToolInputError(f"case not found: {case_id}")
    return row, suite


async def _case_get(
    args: CaseGetArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    row, _suite = await _resolve_case(session, ctx, args.case_id)
    steps = await TestCaseRepo(session).get_steps(row.id)
    # Project the row onto plain dicts BEFORE touching lazy ORM attributes —
    # `row.steps` would lazy-load outside greenlet context and crash.
    brief: dict[str, object] = {
        "public_id": row.public_id,
        "title": row.title,
        "description": row.description,
        "priority": row.priority,
        "status": row.status,
        "steps": [{"order": s.order, "action": s.action, "expected": s.expected} for s in steps],
    }
    return {"found": True, "case": brief}


async def _cases_search(
    args: CasesSearchArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    q = args.query.strip().lower()
    rows = await TestCaseRepo(session).list_by_workspace(ctx.workspace_id)
    items = [
        {"public_id": row.public_id, "title": row.title}
        for row in rows
        if q in row.public_id.lower() or q in (row.title or "").lower()
    ]
    return {"items": items[:25]}


def _run_brief(run: Run) -> dict[str, object]:
    return {
        "public_id": run.public_id,
        "name": run.name,
        "status": run.status,
        "env": run.env,
        "trigger": run.trigger,
        "created_at": run.created_at,
        "completed_at": run.completed_at,
        "total_steps": run.total_steps,
        "passed_steps": run.passed_steps,
        "failed_steps": run.failed_steps,
    }


async def _resolve_project(session: AsyncSession, ctx: TenantContext, ref: str) -> Project:
    """Match a project by id, slug or name (case-insensitive) within the workspace."""
    wanted = ref.strip().lower()
    for project in await ProjectRepo(session).list_by_workspace(ctx.workspace_id):
        if wanted in (project.id.lower(), project.slug.lower(), project.name.lower()):
            return project
    raise ToolInputError(f"project not found: {ref}")


async def _project_overview(
    args: ProjectOverviewArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    repo = ProjectRepo(session)
    projects = (
        [await _resolve_project(session, ctx, args.project)]
        if args.project
        else list(await repo.list_by_workspace(ctx.workspace_id))
    )
    items: list[dict[str, object]] = []
    for project in projects:
        runs, _ = await RunRepo(session).list_by_project(project.id, limit=1)
        items.append(
            {
                "id": project.id,
                "slug": project.slug,
                "name": project.name,
                "suite_count": await repo.count_active_suites(project.id),
                "case_count": await repo.count_active_cases(project.id),
                "last_run": _run_brief(runs[0]) if runs else None,
            }
        )
    return {"projects": items}


async def _suites_list(
    args: SuitesListArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    project = await _resolve_project(session, ctx, args.project)
    repo = SuiteRepo(session)
    suites = list(await repo.list_by_project(project.id))
    if args.query:
        q = args.query.strip().lower()
        suites = [s for s in suites if q in s.name.lower()]
    counts = await repo.case_counts([s.id for s in suites])
    return {
        "project": project.name,
        "total": len(suites),
        "suites": [
            {"id": s.id, "name": s.name, "case_count": counts.get(s.id, 0)} for s in suites[:50]
        ],
    }


async def _suite_get(
    args: SuiteGetArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    suite = await SuiteRepo(session).get_active_by_id(args.suite_id)
    project = await ProjectRepo(session).get_active_by_id(suite.project_id) if suite else None
    if suite is None or project is None or project.workspace_id != ctx.workspace_id:
        raise ToolInputError(f"suite not found: {args.suite_id}")
    cases, _ = await TestCaseRepo(session).list_by_suite_filtered(suite.id, limit=100)
    return {
        "suite": {
            "id": suite.id,
            "name": suite.name,
            "description": suite.description,
            "project": project.name,
        },
        "cases": [
            {"public_id": c.public_id, "title": c.title, "priority": c.priority, "status": c.status}
            for c in cases
        ],
    }


async def _runs_list(
    args: RunsListArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    project = await _resolve_project(session, ctx, args.project)
    runs, _ = await RunRepo(session).list_by_project(project.id, limit=args.limit)
    return {"project": project.name, "runs": [_run_brief(r) for r in runs]}


async def _run_get(
    args: RunGetArgs, *, session: AsyncSession, ctx: TenantContext
) -> dict[str, object]:
    repo = RunRepo(session)
    run_id = await repo.resolve_id(args.run_id, ctx.workspace_id)
    found = await repo.get_with_summary(run_id) if run_id else None
    if found is None or found[0].workspace_id != ctx.workspace_id:
        raise ToolInputError(f"run not found: {args.run_id}")
    run, summary = found
    # Live counters: the columns on Run are only final once the run completes.
    return {
        "run": {
            **_run_brief(run),
            "total_steps": summary.total_steps,
            "passed_steps": summary.passed_steps,
            "failed_steps": summary.failed_steps,
        }
    }


# ---------------------------------------------------------------------------
# Mutating tools
# ---------------------------------------------------------------------------


async def _case_update_meta(
    args: CaseUpdateMetaArgs,
    *,
    session: AsyncSession,
    ctx: TenantContext,
    case_service: TestCaseService,
) -> dict[str, object]:
    from suitest_api.schemas.test_case import TestCaseUpdate

    row, _suite = await _resolve_case(session, ctx, args.case_id)
    # Only the keys the caller actually sent — building TestCaseUpdate with every
    # field would mark omitted ones as explicitly set and clear NOT-NULL columns
    # (title/priority) on a partial edit.
    body = TestCaseUpdate.model_validate(args.model_dump(exclude={"case_id"}, exclude_unset=True))
    outcome = await case_service.update(row.id, body, if_unmodified_since=None)
    if outcome is None:
        raise ToolInputError(f"case not found: {args.case_id}")
    return {"ok": True, "public_id": outcome.detail.public_id}


async def _case_set_steps(
    args: CaseSetStepsArgs,
    *,
    session: AsyncSession,
    ctx: TenantContext,
    case_service: TestCaseService,
) -> dict[str, object]:
    from suitest_api.schemas.test_case import StepAppend

    # replace_steps keys off the INTERNAL id — resolve the public id first.
    row, _suite = await _resolve_case(session, ctx, args.case_id)
    steps = [StepAppend.model_validate(s.model_dump(by_alias=True)) for s in args.steps]
    outcome = await case_service.replace_steps(row.id, steps, if_unmodified_since=None)
    if outcome is None:
        raise ToolInputError(f"case not found: {args.case_id}")
    return {"ok": True, "public_id": outcome.detail.public_id, "step_count": len(steps)}


async def _run_trigger(
    args: RunTriggerArgs,
    *,
    session: AsyncSession,
    ctx: TenantContext,
    arq: ArqRedis | None,
) -> dict[str, object]:
    from fastapi import HTTPException

    from suitest_api.deps.run_dispatch import dispatch_run
    from suitest_api.services.run_service import RunService
    from suitest_api.settings import get_settings

    svc = RunService(ctx, RunRepo(session), ProjectRepo(session))
    try:
        run = await svc.create_run_for_suite(
            suite_id=args.suite_id,
            name=None,
            branch=None,
            commit_sha=None,
            env=args.env,
            trigger=RunTrigger.AGENT,
            user_id=ctx.user_id,
            mcp_routing_override=None,
        )
        job_id = await dispatch_run(
            mode=get_settings().mode, arq=arq, run_id=run.id, queue_name="suitest:runs"
        )
    except (ValueError, HTTPException) as exc:
        raise ToolInputError(str(getattr(exc, "detail", exc))) from exc
    if job_id is not None:
        await svc.attach_arq_job_id(run.id, job_id)
    return {"ok": True, "run_id": run.public_id, "status": run.status}
