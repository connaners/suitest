"""Tests for cross-platform wake-lock sleep prevention (wake_lock.py)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from suitest_core.wake_lock import (
    _SleepInhibitor,
    async_prevent_sleep,
    prevent_sleep,
)


def test_sleep_inhibitor_acquire_and_release_darwin() -> None:
    mock_proc = MagicMock()
    with (
        patch("platform.system", return_value="Darwin"),
        patch("subprocess.Popen", return_value=mock_proc) as mock_popen,
        patch("suitest_core.wake_lock.atexit.register") as mock_atexit_reg,
        patch("suitest_core.wake_lock.atexit.unregister") as mock_atexit_unreg,
    ):
        inhibitor = _SleepInhibitor(reason="Test suite")
        assert inhibitor.acquire() is True
        assert inhibitor.is_active is True
        mock_popen.assert_called_once()
        mock_atexit_reg.assert_called_once_with(inhibitor.release)

        inhibitor.release()
        assert inhibitor.is_active is False
        mock_proc.terminate.assert_called_once()
        mock_atexit_unreg.assert_called_once_with(inhibitor.release)


def test_sleep_inhibitor_fail_open_on_exception() -> None:
    with (
        patch("platform.system", return_value="Darwin"),
        patch("subprocess.Popen", side_effect=OSError("caffeinate not found")),
    ):
        inhibitor = _SleepInhibitor(reason="Test suite")
        # Must fail open gracefully without raising
        assert inhibitor.acquire() is False
        assert inhibitor.is_active is False
        # release() on inactive inhibitor is a safe no-op
        inhibitor.release()


def test_prevent_sleep_context_manager() -> None:
    mock_proc = MagicMock()
    with (
        patch("platform.system", return_value="Darwin"),
        patch("subprocess.Popen", return_value=mock_proc),
    ):
        with prevent_sleep("Context test") as inh:
            assert inh.is_active is True
        assert inh.is_active is False


@pytest.mark.asyncio
async def test_async_prevent_sleep_context_manager() -> None:
    mock_proc = MagicMock()
    with (
        patch("platform.system", return_value="Darwin"),
        patch("subprocess.Popen", return_value=mock_proc),
    ):
        async with async_prevent_sleep("Async test") as inh:
            assert inh.is_active is True
        assert inh.is_active is False


def test_sleep_inhibitor_skipped_in_container_or_headless() -> None:
    with (
        patch("suitest_core.wake_lock._is_headless_or_container", return_value=True),
        patch("subprocess.Popen") as mock_popen,
    ):
        inhibitor = _SleepInhibitor(reason="Docker test")
        assert inhibitor.acquire() is False
        assert inhibitor.is_active is False
        mock_popen.assert_not_called()


def test_sleep_inhibitor_windows_refcount() -> None:
    import suitest_core.wake_lock as wl

    mock_kernel32 = MagicMock()
    mock_kernel32.kernel32.SetThreadExecutionState.return_value = 1
    with (
        patch("platform.system", return_value="Windows"),
        patch("suitest_core.wake_lock._is_headless_or_container", return_value=False),
        patch("ctypes.windll", mock_kernel32, create=True),
    ):
        inh1 = _SleepInhibitor(reason="Win test 1")
        inh2 = _SleepInhibitor(reason="Win test 2")

        assert inh1.acquire() is True
        assert wl._windows_lock_refcount == 1
        assert inh2.acquire() is True
        assert wl._windows_lock_refcount == 2

        # Releasing first inhibitor should NOT reset ES_CONTINUOUS
        inh1.release()
        assert wl._windows_lock_refcount == 1
        mock_kernel32.kernel32.SetThreadExecutionState.assert_called_with(
            wl._ES_CONTINUOUS | wl._ES_SYSTEM_REQUIRED
        )

        # Releasing second inhibitor drops refcount to 0 and resets ES_CONTINUOUS
        inh2.release()
        assert wl._windows_lock_refcount == 0
        mock_kernel32.kernel32.SetThreadExecutionState.assert_called_with(wl._ES_CONTINUOUS)
