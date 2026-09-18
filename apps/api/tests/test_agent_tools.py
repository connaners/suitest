"""Tests for the chat panel's project / suite / run tools (``agent_tools``)."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from suitest_api.deps.scope import TenantContext
from suitest_api.services.agent_tools import ToolDeniedError, ToolInputError, execute_tool
from suitest_db.models.case import TestCase
from suitest_db.models.project import Project, Suite
from suitest_db.models.run import Run
from suitest_shared.domain.enums import CaseSource, Role, RunStatus, RunTrigger

if TYPE_CHECKING:
    from api_harness import ApiDb
    from arq.connections import ArqRedis
    from suitest_api.services.test_case_service import TestCaseService


async def _seed(api_db: ApiDb, slug: str) -> tuple[TenantContext, Suite]:
    user = await api_db.seed_user(email=f"{slug}@example.com")
    ws = await api_db.member_workspace(user, slug=slug)
    proj = Project(workspace_id=ws.id, slug=f"{slug}-omni", name="Omni")
    await api_db.add_all([proj])
    smoke = Suite(project_id=proj.id, name="Smoke", order=0)
    regression = Suite(project_id=proj.id, name="Regression", order=1)
    await api_db.add_all([smoke, regression])
    await api_db.add_all(
        [
            TestCase(
                suite_id=smoke.id,
                public_id=f"TC-{slug}-{i}",
                name=f"case {i}",
                source=CaseSource.MANUAL,
            )
            for i in range(2)
        ]
    )
    await api_db.add_all(
        [
            Run(
                workspace_id=ws.id,
                project_id=proj.id,
                public_id="R-1001",
                name="Nightly",
                trigger=RunTrigger.MANUAL,
                status=RunStatus.PASS,
            )
        ]
    )
    ctx = TenantContext(workspace_id=ws.id, user_id=str(user.id), role=Role.QA)
    return ctx, smoke


async def _call(
    api_db: ApiDb,
    ctx: TenantContext,
    tool: str,
    args: dict[str, object],
    *,
    confirmed: bool = False,
    arq: ArqRedis | None = None,
) -> dict[str, object]:
    async with api_db.maker() as session:
        result = await execute_tool(
            tool,
            args,
            session=session,
            ctx=ctx,
            case_service=cast("TestCaseService", MagicMock()),
            confirmed=confirmed,
            arq=arq,
        )
        await session.commit()
        return result


@pytest.mark.asyncio
async def test_project_overview_counts_suites_and_cases(api_db: ApiDb) -> None:
    ctx, _ = await _seed(api_db, "tool-overview")

    out = await _call(api_db, ctx, "project.overview", {"project": "omni"})

    projects = cast("list[dict[str, object]]", out["projects"])
    assert len(projects) == 1
    assert projects[0]["suite_count"] == 2
    assert projects[0]["case_count"] == 2
    last_run = cast("dict[str, object]", projects[0]["last_run"])
    assert last_run["public_id"] == "R-1001"


@pytest.mark.asyncio
async def test_suites_list_and_get(api_db: ApiDb) -> None:
    ctx, smoke = await _seed(api_db, "tool-suites")

    listed = await _call(api_db, ctx, "suites.list", {"project": "Omni"})
    assert listed["total"] == 2
    suites = cast("list[dict[str, object]]", listed["suites"])
    assert {s["name"]: s["case_count"] for s in suites} == {"Smoke": 2, "Regression": 0}

    filtered = await _call(api_db, ctx, "suites.list", {"project": "omni", "query": "reg"})
    assert filtered["total"] == 1

    got = await _call(api_db, ctx, "suite.get", {"suite_id": smoke.id})
    assert len(cast("list[object]", got["cases"])) == 2


@pytest.mark.asyncio
async def test_tools_do_not_leak_across_workspaces(api_db: ApiDb) -> None:
    _, smoke = await _seed(api_db, "tool-owner")
    other, _ = await _seed(api_db, "tool-other")

    with pytest.raises(ToolInputError):
        await _call(api_db, other, "suite.get", {"suite_id": smoke.id})
    with pytest.raises(ToolInputError):
        await _call(api_db, other, "project.overview", {"project": "tool-owner-omni"})


@pytest.mark.asyncio
async def test_runs_list_and_get(api_db: ApiDb) -> None:
    ctx, _ = await _seed(api_db, "tool-runs")

    listed = await _call(api_db, ctx, "runs.list", {"project": "omni"})
    assert [r["public_id"] for r in cast("list[dict[str, object]]", listed["runs"])] == ["R-1001"]

    got = await _call(api_db, ctx, "run.get", {"run_id": "R-1001"})
    assert cast("dict[str, object]", got["run"])["status"] == RunStatus.PASS


@pytest.mark.asyncio
async def test_run_trigger_needs_confirm_then_enqueues(api_db: ApiDb) -> None:
    ctx, smoke = await _seed(api_db, "tool-trigger")

    with pytest.raises(ToolDeniedError):
        await _call(api_db, ctx, "run.trigger", {"suite_id": smoke.id})

    arq = AsyncMock()
    arq.enqueue_job.return_value = MagicMock(job_id="job-1")
    out = await _call(
        api_db,
        ctx,
        "run.trigger",
        {"suite_id": smoke.id},
        confirmed=True,
        arq=cast("ArqRedis", arq),
    )

    assert out["ok"] is True
    arq.enqueue_job.assert_awaited_once()
    got = await _call(api_db, ctx, "run.get", {"run_id": out["run_id"]})
    run = cast("dict[str, object]", got["run"])
    assert run["trigger"] == RunTrigger.AGENT
    assert run["status"] == RunStatus.QUEUED


@pytest.mark.asyncio
async def test_run_trigger_leaves_no_run_when_dispatch_fails(api_db: ApiDb) -> None:
    ctx, smoke = await _seed(api_db, "tool-orphan")

    # No ARQ pool in server mode: dispatch refuses after the run row was flushed.
    async with api_db.maker() as session:
        with pytest.raises(ToolInputError):
            await execute_tool(
                "run.trigger",
                {"suite_id": smoke.id},
                session=session,
                ctx=ctx,
                case_service=cast("TestCaseService", MagicMock()),
                confirmed=True,
                arq=None,
            )
        # The chat service commits after a tool error to record its note.
        await session.commit()

    listed = await _call(api_db, ctx, "runs.list", {"project": "omni"})
    assert [r["public_id"] for r in cast("list[dict[str, object]]", listed["runs"])] == ["R-1001"]
