"""Tests for lazy read-time reconciliation and interrupted run recovery.

Simulates laptop sleep scenarios:
1. Short sleep (<3 min): Run stays RUNNING, lazy reconciliation does NOT trigger (explains why short sleep resumes).
2. Long sleep (>15 min): Run transitions to INTERRUPTED on next read with metadata.
3. Resume Remaining: Rerun on an INTERRUPTED run selects unexecuted test cases.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from suitest_api.routers.runs import _reconcile_lazy_interrupted_run
from suitest_db.models.run import Run, RunStep
from suitest_shared.domain.enums import RunStatus, RunTrigger


def _make_run(
    *,
    status: RunStatus = RunStatus.RUNNING,
    updated_at: datetime | None = None,
    started_at: datetime | None = None,
    created_at: datetime | None = None,
    selection: list[dict[str, object]] | None = None,
) -> Run:
    now = datetime.now(UTC)
    run = Run()
    run.id = "run-test-1"
    run.public_id = "RUN-1001"
    run.project_id = "prj-test"
    run.name = "Sleep Simulation Run"
    run.status = status
    run.trigger = RunTrigger.MANUAL
    run.env = "staging"
    run.created_at = created_at or (now - timedelta(minutes=25))
    run.started_at = started_at or (now - timedelta(minutes=25))
    run.updated_at = updated_at or (now - timedelta(minutes=20))
    run.completed_at = None
    run.duration_ms = None
    run.metadata_json = {"selection": selection or []}
    return run


@pytest.mark.asyncio
async def test_short_sleep_under_15m_stays_running() -> None:
    """A short sleep (< 15 min cutoff) does NOT trigger lazy reconciliation.

    This reproduces and verifies why when a user sleeps/closes their laptop
    for only 1-3 minutes and reopens it, the run remains RUNNING and can resume.
    """
    session = AsyncMock()
    # Updated 2 minutes ago (short sleep)
    short_sleep_time = datetime.now(UTC) - timedelta(minutes=2)
    run = _make_run(status=RunStatus.RUNNING, updated_at=short_sleep_time)

    did_reconcile = await _reconcile_lazy_interrupted_run(session, run)

    assert did_reconcile is False
    assert run.status == RunStatus.RUNNING
    assert run.completed_at is None
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_long_sleep_over_15m_transitions_to_interrupted() -> None:
    """An extended sleep (> 15 min cutoff) or connection drop triggers lazy reconciliation.

    When the user wakes the laptop or opens the UI after > 15 minutes of inactivity,
    the next read endpoint reconciles the run to INTERRUPTED with audit metadata.
    """
    session = AsyncMock()
    session.add = MagicMock()
    # Updated 20 minutes ago (extended sleep / dropped connection)
    last_active = datetime.now(UTC) - timedelta(minutes=20)
    started = datetime.now(UTC) - timedelta(minutes=25)
    run = _make_run(status=RunStatus.RUNNING, started_at=started, updated_at=last_active)

    did_reconcile = await _reconcile_lazy_interrupted_run(session, run)

    assert did_reconcile is True
    assert run.status == RunStatus.INTERRUPTED
    assert run.completed_at == last_active
    assert run.duration_ms == int((last_active - started).total_seconds() * 1000)
    assert "15m of inactivity" in (run.metadata_json or {}).get("reconciliation", "")
    session.commit.assert_called_once()


@pytest.mark.asyncio
async def test_step_activity_within_15m_prevents_false_interruption() -> None:
    """Steps completed recently keep the run alive even if run.updated_at is stale."""
    session = AsyncMock()
    run = _make_run(
        status=RunStatus.RUNNING,
        updated_at=datetime.now(UTC) - timedelta(minutes=20),
    )
    # A step finished 3 minutes ago
    step = RunStep()
    step.created_at = datetime.now(UTC) - timedelta(minutes=5)
    step.started_at = datetime.now(UTC) - timedelta(minutes=4)
    step.completed_at = datetime.now(UTC) - timedelta(minutes=3)

    did_reconcile = await _reconcile_lazy_interrupted_run(session, run, steps=[step])

    assert did_reconcile is False
    assert run.status == RunStatus.RUNNING


@pytest.mark.asyncio
async def test_terminal_run_is_never_reconciled() -> None:
    """Completed runs (PASS, FAIL, CANCELLED) are never modified by lazy reconciliation."""
    session = AsyncMock()
    old_time = datetime.now(UTC) - timedelta(hours=2)
    run = _make_run(status=RunStatus.PASS, updated_at=old_time)

    did_reconcile = await _reconcile_lazy_interrupted_run(session, run)

    assert did_reconcile is False
    assert run.status == RunStatus.PASS
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_step_activity_queried_from_db_prevents_false_interruption_when_steps_none() -> None:
    """When list_runs calls reconciliation with steps=None, recent DB step keeps run RUNNING."""
    session = AsyncMock()
    run = _make_run(
        status=RunStatus.RUNNING,
        updated_at=datetime.now(UTC) - timedelta(minutes=20),
    )
    # Mock DB scalar returning a step completed 2 minutes ago
    session.scalar.return_value = datetime.now(UTC) - timedelta(minutes=2)

    did_reconcile = await _reconcile_lazy_interrupted_run(session, run, steps=None)

    assert did_reconcile is False
    assert run.status == RunStatus.RUNNING
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_queued_run_is_never_interrupted() -> None:
    """A QUEUED run waiting >15m behind long runs is never marked INTERRUPTED."""
    session = AsyncMock()
    old_time = datetime.now(UTC) - timedelta(minutes=30)
    run = _make_run(status=RunStatus.QUEUED, created_at=old_time, updated_at=old_time)

    did_reconcile = await _reconcile_lazy_interrupted_run(session, run)

    assert did_reconcile is False
    assert run.status == RunStatus.QUEUED
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_lazy_reconciliation_writes_audit_log() -> None:
    """Reconciling to INTERRUPTED writes an audit log entry per CLAUDE.md §2.2."""
    from unittest.mock import patch

    session = AsyncMock()
    last_active = datetime.now(UTC) - timedelta(minutes=20)
    run = _make_run(status=RunStatus.RUNNING, updated_at=last_active)
    run.workspace_id = "ws-audit-test"

    with patch("suitest_api.routers.runs.write_audit", new_callable=AsyncMock) as mock_audit:
        did_reconcile = await _reconcile_lazy_interrupted_run(session, run)

        assert did_reconcile is True
        mock_audit.assert_called_once()
        assert mock_audit.call_args.kwargs["action"] == "run.interrupted"
        assert mock_audit.call_args.kwargs["resource_id"] == run.id
        assert mock_audit.call_args.kwargs["workspace_id"] == "ws-audit-test"
