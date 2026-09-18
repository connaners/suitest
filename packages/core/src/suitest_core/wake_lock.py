"""Cross-platform system sleep prevention (Wake-Lock) for long test runs.

Prevents the operating system from entering idle sleep while automated test runs
are executing (e.g., 30-minute end-to-end suites or chunked test generation).
Supports macOS (caffeinate), Windows (SetThreadExecutionState), and Linux (systemd-inhibit).
Fails open gracefully in restricted or headless environments (CI / Docker).
"""

from __future__ import annotations

import atexit
import contextlib
import os
import platform
import subprocess
import threading
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

log = structlog.get_logger(__name__)

# Windows SetThreadExecutionState flags
_ES_CONTINUOUS = 0x80000000
_ES_SYSTEM_REQUIRED = 0x00000001
# Thread-safe refcount for Windows SetThreadExecutionState to prevent
# concurrent runs on the same thread from resetting each other's wake-lock
_windows_lock_refcount = 0
_windows_lock_mutex = threading.Lock()


def _is_headless_or_container() -> bool:
    """Check if executing inside a container or headless server environment."""
    if os.path.exists("/.dockerenv") or ("CONTAINER" in os.environ or "container" in os.environ):
        return True
    return bool(
        platform.system() == "Linux"
        and not os.environ.get("DISPLAY")
        and not os.environ.get("WAYLAND_DISPLAY")
        and not os.environ.get("XDG_CURRENT_DESKTOP")
    )


class _SleepInhibitor:
    """Manages the platform-specific sleep inhibition state."""

    def __init__(self, reason: str = "Suitest test run execution") -> None:
        self.reason = reason
        self._proc: subprocess.Popen[Any] | None = None
        self._active = False
        self._system = platform.system()

    def _on_acquired(self) -> None:
        self._active = True
        with contextlib.suppress(Exception):
            atexit.register(self.release)

    def acquire(self) -> bool:
        """Acquire the OS-level sleep inhibition lock."""
        if self._active:
            return True

        try:
            if _is_headless_or_container():
                log.debug("wake_lock.skipped_headless_or_container")
                return False

            if self._system == "Darwin":
                # macOS: caffeinate -i prevents idle sleep; -w <pid> ties it to our process.
                pid = os.getpid()
                self._proc = subprocess.Popen(
                    ["caffeinate", "-i", "-s", "-w", str(pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                self._on_acquired()
                log.info("wake_lock.acquired", system="Darwin", mechanism="caffeinate", pid=pid)
                return True

            elif self._system == "Windows":
                # Windows: SetThreadExecutionState via Win32 kernel32 with thread refcounting
                import ctypes

                kernel32 = getattr(ctypes, "windll", None)
                if kernel32 and hasattr(kernel32, "kernel32"):
                    global _windows_lock_refcount
                    with _windows_lock_mutex:
                        _windows_lock_refcount += 1
                        if _windows_lock_refcount == 1:
                            kernel32.kernel32.SetThreadExecutionState(
                                _ES_CONTINUOUS | _ES_SYSTEM_REQUIRED
                            )
                    self._on_acquired()
                    log.info(
                        "wake_lock.acquired",
                        system="Windows",
                        mechanism="SetThreadExecutionState",
                    )
                    return True
                log.debug("wake_lock.windows_ctypes_unavailable")
                return False

            elif self._system == "Linux":
                # Linux: try systemd-inhibit if present
                try:
                    self._proc = subprocess.Popen(
                        [
                            "systemd-inhibit",
                            "--what=idle",
                            "--who=suitest",
                            f"--why={self.reason}",
                            "sleep",
                            "86400",
                        ],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    self._on_acquired()
                    log.info("wake_lock.acquired", system="Linux", mechanism="systemd-inhibit")
                    return True
                except FileNotFoundError:
                    # Minimal Linux container / headless server without systemd-inhibit
                    log.debug("wake_lock.linux_systemd_inhibit_not_found")
                    return False

        except Exception as exc:
            # Fail-open: Never abort the user's test run because wake-lock acquisition failed
            log.warning("wake_lock.acquire_failed", error=str(exc))
            return False

        return False

    def release(self) -> None:
        """Release the OS-level sleep inhibition lock."""
        if not self._active:
            return

        with contextlib.suppress(Exception):
            atexit.unregister(self.release)

        try:
            if self._proc is not None:
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=1.0)
                except (subprocess.TimeoutExpired, ProcessLookupError, OSError):
                    with contextlib.suppress(Exception):
                        self._proc.kill()
                self._proc = None

            if self._system == "Windows":
                import ctypes

                kernel32 = getattr(ctypes, "windll", None)
                if kernel32 and hasattr(kernel32, "kernel32"):
                    global _windows_lock_refcount
                    with _windows_lock_mutex:
                        if _windows_lock_refcount > 0:
                            _windows_lock_refcount -= 1
                            if _windows_lock_refcount == 0:
                                kernel32.kernel32.SetThreadExecutionState(_ES_CONTINUOUS)

            log.info("wake_lock.released", system=self._system)
        except Exception as exc:
            log.debug("wake_lock.release_error", error=str(exc))
        finally:
            self._active = False

    @property
    def is_active(self) -> bool:
        return self._active


@contextlib.contextmanager
def prevent_sleep(reason: str = "Suitest test run execution") -> Iterator[_SleepInhibitor]:
    """Synchronous context manager to inhibit OS idle sleep during a block."""
    inhibitor = _SleepInhibitor(reason=reason)
    inhibitor.acquire()
    try:
        yield inhibitor
    finally:
        inhibitor.release()


@contextlib.asynccontextmanager
async def async_prevent_sleep(
    reason: str = "Suitest test run execution",
) -> AsyncIterator[_SleepInhibitor]:
    """Asynchronous context manager to inhibit OS idle sleep during a block."""
    inhibitor = _SleepInhibitor(reason=reason)
    inhibitor.acquire()
    try:
        yield inhibitor
    finally:
        inhibitor.release()
