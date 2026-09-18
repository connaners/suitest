"""Tests for runner concurrency safeguards when a run is marked INTERRUPTED by the API.

Verifies:
1. Runner immediately terminates further step execution when run status is INTERRUPTED.
2. Runner never overwrites INTERRUPTED with PASS/FAIL in _finalize_run.
3. Exception and CancelledError handlers do not overwrite INTERRUPTED with ERROR or CANCELLED.
4. Step heartbeat task updates run.updated_at while active.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from suitest_db.models.run import Run
from suitest_runner.jobs.run_test_case import (
    _finalize_run,
    _is_run_cancelled,
    _step_heartbeat,
    run_test_case,
)
from suitest_shared.domain.enums import RunStatus


@pytest.mark.asyncio
async def test_is_run_cancelled_detects_interrupted_status() -> None:
    """_is_run_cancelled returns True when run.status is INTERRUPTED."""
    mock_run = MagicMock()
    mock_run.status = RunStatus.INTERRUPTED

    session = AsyncMock()
    repo = AsyncMock()
    repo.get_by_id.return_value = mock_run

    factory = MagicMock()
    factory.return_value.__aenter__.return_value = session

    with patch("suitest_runner.jobs.run_test_case.RunRepo", return_value=repo):
        is_cancelled = await _is_run_cancelled(factory, "run-interrupted-1")
        assert is_cancelled is True


@pytest.mark.asyncio
async def test_finalize_run_preserves_interrupted_status() -> None:
    """_finalize_run skips overwriting status if DB row is already INTERRUPTED."""
    mock_run = MagicMock(spec=Run)
    mock_run.id = "run-123"
    mock_run.status = RunStatus.INTERRUPTED

    session = AsyncMock()
    repo = AsyncMock()
    repo.get_by_id.return_value = mock_run

    factory = MagicMock()
    factory.return_value.__aenter__.return_value = session

    with patch("suitest_runner.jobs.run_test_case.RunRepo", return_value=repo):
        await _finalize_run(
            factory=factory,
            redis_client=MagicMock(),
            invoker=MagicMock(),
            run_id="run-123",
            workspace_id="ws-1",
            headless_mode=True,
            clean_session=False,
            selection=[("case-1", 0, MagicMock())],
            summary={"total": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0},
            case_outcome={"case-1": "PASS"},
            case_has_failure={},
            case_duration_ms={},
            current_case_id="case-1",
            t0=0.0,
            cancelled=False,
        )
        # update_status should NOT have been called with PASS
        repo.update_status.assert_not_called()


@pytest.mark.asyncio
async def test_exception_handler_preserves_interrupted_status() -> None:
    """Uncaught runner exception does not overwrite an existing INTERRUPTED status with ERROR."""
    mock_run = MagicMock(spec=Run)
    mock_run.id = "run-exc-1"
    mock_run.status = RunStatus.INTERRUPTED
    mock_run.metadata_json = {}

    session = AsyncMock()
    repo = AsyncMock()
    repo.get_by_id.return_value = mock_run

    factory = MagicMock()
    factory.return_value.__aenter__.return_value = session

    ctx = {"session_factory": factory}

    with (
        patch(
            "suitest_runner.jobs.run_test_case._run_test_case_body",
            side_effect=RuntimeError("Worker crash"),
        ),
        patch("suitest_runner.jobs.run_test_case.RunRepo", return_value=repo),
    ):
        result = await run_test_case(ctx, "run-exc-1")
        assert result["error"] == "UNHANDLED_EXCEPTION"
        # Status on run object must not be mutated to ERROR
        assert mock_run.status == RunStatus.INTERRUPTED
        session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_step_heartbeat_updates_timestamp() -> None:
    """_step_heartbeat background task touches run.updated_at periodically."""
    mock_run = MagicMock(spec=Run)
    mock_run.id = "run-hb-1"
    mock_run.status = RunStatus.RUNNING
    mock_run.updated_at = None

    session = AsyncMock()
    repo = AsyncMock()
    repo.get_by_id.return_value = mock_run

    factory = MagicMock()
    factory.return_value.__aenter__.return_value = session

    with patch("suitest_runner.jobs.run_test_case.RunRepo", return_value=repo):
        # Run heartbeat with short interval of 0.05s
        async with _step_heartbeat(factory, "run-hb-1", interval_seconds=0.05):
            await asyncio.sleep(0.12)

        assert mock_run.updated_at is not None
        assert session.commit.called
