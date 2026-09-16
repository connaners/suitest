"""LOCAL-mode run supervisor — no Redis, no ARQ.

`suitest up` launches this alongside the API. It polls the DB for runs left in
``QUEUED`` by the local dispatcher (see api ``run_dispatch``) and executes each
one in-process via :func:`run_test_case`, one at a time.

ponytail: single-concurrency polling loop; upgrade path is the ARQ worker
(server mode) if throughput ever matters. Kept deliberately dumb.
"""

from __future__ import annotations

import asyncio
import fcntl
import importlib
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import select
from suitest_db.models.run import Run
from suitest_shared.domain.enums import RunStatus

from suitest_runner.jobs.run_test_case import run_test_case
from suitest_runner.local_ctx import build_local_ctx

if TYPE_CHECKING:
    import io
    from collections.abc import Callable, Coroutine

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

log = structlog.get_logger(__name__)

_POLL_INTERVAL_SECONDS = 1.0


def _acquire_supervisor_lock() -> io.TextIOWrapper | None:
    """Acquire a single-instance advisory lock for the local supervisor.

    Returns the open file handle if acquired, or None if another supervisor is active.
    """
    try:
        lock_dir = Path.cwd() / ".suitest"
        lock_dir.mkdir(parents=True, exist_ok=True)
        lock_file = lock_dir / "supervisor.lock"
        f = open(lock_file, "a+", encoding="utf-8")  # noqa: SIM115
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        f.seek(0)
        f.truncate()
        f.write(f"{os.getpid()}\n")
        f.flush()
        return f
    except (BlockingIOError, OSError):
        return None


async def _reconcile_zombie_runs(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Reconcile runs left in RUNNING from a prior crashed supervisor process."""
    try:
        async with session_factory() as session:
            rows = await session.execute(select(Run).where(Run.status == RunStatus.RUNNING))
            zombies = rows.scalars().all()
            if zombies:
                now = datetime.now(UTC)
                for z in zombies:
                    z.status = RunStatus.ERROR
                    z.completed_at = now
                    meta = dict(z.metadata_json or {})
                    meta["reconciliation"] = "Supervisor restarted while run was in progress"
                    z.metadata_json = meta
                    log.warning("supervisor.zombie_run_reconciled", run_id=z.id)
                await session.commit()
    except Exception:
        log.warning("supervisor.zombie_reconciliation_failed", exc_info=True)


async def _next_queued_run_ids(session_factory: async_sessionmaker[AsyncSession]) -> list[str]:
    async with session_factory() as session:
        rows = await session.execute(
            select(Run.id).where(Run.status == RunStatus.QUEUED).order_by(Run.created_at.asc())
        )
        return [str(r) for r in rows.scalars().all()]


def _load_run_test_case() -> Callable[
    [dict[str, object], str], Coroutine[object, object, dict[str, object]]
]:
    """Safely reload and return the run_test_case job function.

    If run_test_case has been monkeypatched (e.g. in test suites), the patched
    callable is preserved.
    """
    import suitest_runner.jobs.run_test_case as rtc_mod

    if run_test_case != rtc_mod.run_test_case:
        return run_test_case
    try:
        importlib.reload(rtc_mod)
        return rtc_mod.run_test_case
    except Exception as reload_err:
        log.warning("supervisor.module_reload_failed", error=str(reload_err))
        return run_test_case


async def drain_once(ctx: dict[str, object]) -> None:
    """Run every currently-QUEUED run once, sequentially. Never propagates."""
    factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]  # type: ignore[assignment]
    try:
        run_ids = await _next_queued_run_ids(factory)
    except Exception:
        log.warning("supervisor.poll_error", exc_info=True)
        return
    for run_id in run_ids:
        runner_fn = _load_run_test_case()
        try:
            await runner_fn(ctx, run_id)
        except Exception:
            log.error("supervisor.run_error", run_id=run_id, exc_info=True)


async def serve() -> None:
    """Start the LOCAL-mode polling loop.

    Never run this alongside ARQ workers on the same database — both drain
    QUEUED runs and there is no claim-fencing; a run could execute twice.
    """
    lock = _acquire_supervisor_lock()
    if lock is None:
        log.warning(
            "supervisor.already_running",
            message="Another supervisor instance is already running with file lock; exiting.",
        )
        return

    ctx: dict[str, object] = {}
    try:
        await build_local_ctx(ctx)
        factory: async_sessionmaker[AsyncSession] = ctx["session_factory"]  # type: ignore[assignment]
        await _reconcile_zombie_runs(factory)
        # One startup line so .suitest/logs/supervisor.log proves liveness — the
        # loop is otherwise silent unless a poll/run errors.
        log.info("supervisor.started", poll_interval_seconds=_POLL_INTERVAL_SECONDS)
        while True:
            await drain_once(ctx)
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
    finally:
        engine = ctx.get("engine")
        if engine is not None:
            await engine.dispose()  # type: ignore[attr-defined]
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            lock.close()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(serve())
