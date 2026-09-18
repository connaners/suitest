"""RunService + RunArtifactSignedUrlService tests."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from suitest_api.deps.scope import TenantContext
from suitest_api.services import run_service
from suitest_api.services.run_service import RunArtifactSignedUrlService, RunService
from suitest_db.models.project import Project
from suitest_db.models.run import Artifact, Run
from suitest_db.repositories.runs import RunSummary
from suitest_shared.domain.enums import ArtifactKind, Role, RunStatus, RunTrigger

_NOW = datetime(2026, 5, 28, tzinfo=UTC)


def _ctx(ws: str = "ws_1") -> TenantContext:
    return TenantContext(
        workspace_id=ws, user_id="00000000-0000-0000-0000-000000000001", role=Role.QA
    )


def _project(ws: str) -> Project:
    p = Project(id="proj_1", workspace_id=ws, slug="p", name="P")
    p.created_at = _NOW
    p.updated_at = _NOW
    return p


def _run() -> Run:
    r = Run(
        id="run_1",
        public_id="RUN-1",
        project_id="proj_1",
        name="nightly",
        trigger=RunTrigger.MANUAL,
        env="staging",
        status=RunStatus.PASS,
        total_steps=3,
        passed_steps=3,
        failed_steps=0,
    )
    r.created_at = _NOW
    r.updated_at = _NOW
    return r


def _artifact() -> Artifact:
    a = Artifact(
        id="art_1",
        run_step_id="rs_1",
        kind=ArtifactKind.SCREENSHOT,
        url="s3://bucket/art_1.png",
        size_bytes=100,
        mime_type="image/png",
    )
    a.created_at = _NOW
    return a


@pytest.mark.asyncio
async def test_run_scopes_by_workspace() -> None:
    repo = AsyncMock()
    repo.list_by_project.return_value = ([_run()], None)
    project_repo = AsyncMock()
    project_repo.get_by_id.return_value = _project("ws_1")
    svc = RunService(_ctx("ws_1"), repo, project_repo)

    out = await svc.list("proj_1")

    project_repo.get_by_id.assert_awaited_once_with("proj_1")
    assert out is not None and [r.id for r in out] == ["run_1"]


@pytest.mark.asyncio
async def test_run_get_404_when_cross_workspace() -> None:
    repo = AsyncMock()
    repo.get_with_summary.return_value = (
        _run(),
        RunSummary(total_steps=3, passed_steps=3, failed_steps=0, duration_ms=None),
    )
    project_repo = AsyncMock()
    project_repo.get_by_id.return_value = _project("ws_OTHER")
    svc = RunService(_ctx("ws_1"), repo, project_repo)

    assert await svc.get_by_id("run_1") is None


@pytest.mark.asyncio
async def test_signed_url_in_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = AsyncMock()
    repo.get_by_id.return_value = _run()
    repo.get_artifacts.return_value = [_artifact()]
    project_repo = AsyncMock()
    project_repo.get_by_id.return_value = _project("ws_1")
    monkeypatch.setattr(run_service, "_presign", lambda url, *, expires_in: f"signed::{url}")
    svc = RunArtifactSignedUrlService(_ctx("ws_1"), repo, project_repo)

    out = await svc.signed_url("run_1", "art_1")

    assert out is not None
    assert out.url == "signed::s3://bucket/art_1.png"
    assert out.artifact_id == "art_1"


@pytest.mark.asyncio
async def test_signed_url_404_when_cross_workspace() -> None:
    repo = AsyncMock()
    repo.get_by_id.return_value = _run()
    project_repo = AsyncMock()
    project_repo.get_by_id.return_value = _project("ws_OTHER")
    svc = RunArtifactSignedUrlService(_ctx("ws_1"), repo, project_repo)

    assert await svc.signed_url("run_1", "art_1") is None


def test_run_detail_error_message_mapping() -> None:
    from suitest_api.schemas.run import RunDetail, RunSummary

    r = _run()
    r.metadata_json = {"error": "Run timed out: no heartbeat or progress update received"}
    detail = RunDetail(
        id=r.id,
        public_id=r.public_id,
        project_id=r.project_id,
        name=r.name,
        env=r.env,
        trigger=r.trigger,
        status=r.status,
        created_at=r.created_at,
        updated_at=r.updated_at,
        summary=RunSummary(total_steps=0, passed_steps=0, failed_steps=0),
        error_message=r.metadata_json["error"],
    )
    assert detail.error_message == "Run timed out: no heartbeat or progress update received"


@pytest.mark.asyncio
async def test_create_run_zero_steps_raises_value_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from unittest.mock import MagicMock

    repo = AsyncMock()
    project_repo = AsyncMock()
    project = _project("ws_1")
    project_repo.get_by_id.return_value = project

    session = AsyncMock()
    repo.session = session

    # Mock McpProviderRepo list_by_workspace
    monkeypatch.setattr(
        "suitest_api.services.run_service.McpProviderRepo.list_by_workspace",
        AsyncMock(return_value=[]),
    )

    mock_case_rows = MagicMock()
    mock_case_rows.__iter__.return_value = [("case_1", "proj_1")]

    mock_step_rows = MagicMock()
    mock_step_rows.__iter__.return_value = []

    mock_tc_info = MagicMock()
    mock_tc_info.all.return_value = [("case_1", "TC-1", "title", 0)]

    session.execute.side_effect = [mock_case_rows, mock_step_rows, mock_tc_info]

    svc = RunService(_ctx("ws_1"), repo, project_repo)
    with pytest.raises(
        ValueError, match="none of the selected test cases have any steps to execute"
    ):
        await svc.create_run(
            project_id="proj_1",
            name="run",
            selection=[{"case_id": "case_1"}],
            branch=None,
            commit_sha=None,
            env="staging",
            trigger=RunTrigger.MANUAL,
            user_id="user_1",
            mcp_routing_override=None,
        )
