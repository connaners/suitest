import pytest
from suitest_runner import local_supervisor


@pytest.mark.asyncio
async def test_drain_once_runs_each_queued_run(monkeypatch: pytest.MonkeyPatch) -> None:
    executed: list[str] = []

    async def fake_run_test_case(ctx: dict[str, object], run_id: str) -> dict[str, object]:
        executed.append(run_id)
        return {"ok": True}

    async def fake_next_queued(session_factory: object) -> list[str]:
        return ["run-a", "run-b"]

    monkeypatch.setattr(local_supervisor, "run_test_case", fake_run_test_case)
    monkeypatch.setattr(local_supervisor, "_next_queued_run_ids", fake_next_queued)

    ctx = {"session_factory": object()}
    await local_supervisor.drain_once(ctx)

    assert executed == ["run-a", "run-b"]


@pytest.mark.asyncio
async def test_drain_once_poll_error_does_not_propagate(monkeypatch: pytest.MonkeyPatch) -> None:
    """_next_queued_run_ids raising must not crash the loop."""

    async def fake_next_queued(session_factory: object) -> list[str]:
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(local_supervisor, "_next_queued_run_ids", fake_next_queued)

    ctx = {"session_factory": object()}
    # must not raise
    await local_supervisor.drain_once(ctx)


@pytest.mark.asyncio
async def test_drain_once_run_error_continues_remaining(monkeypatch: pytest.MonkeyPatch) -> None:
    """run_test_case raising for one run_id must not block subsequent ones."""
    executed: list[str] = []

    async def fake_run_test_case(ctx: dict[str, object], run_id: str) -> dict[str, object]:
        if run_id == "run-a":
            raise RuntimeError("runner exploded")
        executed.append(run_id)
        return {"ok": True}

    async def fake_next_queued(session_factory: object) -> list[str]:
        return ["run-a", "run-b"]

    monkeypatch.setattr(local_supervisor, "run_test_case", fake_run_test_case)
    monkeypatch.setattr(local_supervisor, "_next_queued_run_ids", fake_next_queued)

    ctx = {"session_factory": object()}
    await local_supervisor.drain_once(ctx)

    assert executed == ["run-b"]


def test_supervisor_lock_mutual_exclusion(
    tmp_path: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pathlib import Path

    assert isinstance(tmp_path, Path)
    monkeypatch.chdir(tmp_path)
    lock1 = local_supervisor._acquire_supervisor_lock()
    assert lock1 is not None

    # Second attempt while lock1 is held should return None
    lock2 = local_supervisor._acquire_supervisor_lock()
    assert lock2 is None

    # After closing lock1, lock can be acquired again
    lock1.close()
    lock3 = local_supervisor._acquire_supervisor_lock()
    assert lock3 is not None
    lock3.close()


@pytest.mark.asyncio
async def test_reconcile_zombie_runs() -> None:
    from unittest.mock import AsyncMock, MagicMock

    from suitest_shared.domain.enums import RunStatus

    zombie = MagicMock()
    zombie.id = "run-zombie"
    zombie.status = RunStatus.RUNNING
    zombie.metadata_json = {}

    session = AsyncMock()
    session.execute.return_value = MagicMock(
        scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[zombie])))
    )

    factory = MagicMock()
    factory.return_value.__aenter__.return_value = session

    await local_supervisor._reconcile_zombie_runs(factory)

    assert zombie.status == RunStatus.INTERRUPTED
    assert (
        zombie.metadata_json["reconciliation"] == "Supervisor restarted while run was in progress"
    )
    session.commit.assert_awaited_once()
