from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from suitest_lifecycle.blackbox.crawler import _goto, _smart_settle


@pytest.mark.asyncio
async def test_smart_settle_fast_path_networkidle() -> None:
    page = MagicMock()
    page.wait_for_load_state = AsyncMock()
    page.wait_for_selector = AsyncMock()
    page.wait_for_timeout = AsyncMock()

    await _smart_settle(page, quiet_sec=1.0, timeout_sec=3.0)

    # 1st call: domcontentloaded
    # 2nd call: networkidle
    assert page.wait_for_load_state.call_count == 2
    page.wait_for_load_state.assert_any_await("domcontentloaded", timeout=5000)
    page.wait_for_load_state.assert_any_await("networkidle", timeout=1000)
    page.wait_for_selector.assert_awaited_once_with("body", state="attached", timeout=5000)
    page.wait_for_timeout.assert_not_called()


@pytest.mark.asyncio
async def test_smart_settle_fallback_on_networkidle_timeout() -> None:
    page = MagicMock()
    page.wait_for_selector = AsyncMock()
    page.wait_for_timeout = AsyncMock()

    async def _mock_load_state(state: str, *args: object, **kwargs: object) -> None:
        if state == "networkidle":
            raise TimeoutError("Network never reached idle (background polling)")

    page.wait_for_load_state = AsyncMock(side_effect=_mock_load_state)

    # Settle should handle TimeoutError gracefully and fallback to timeout
    await _smart_settle(page, quiet_sec=1.5, timeout_sec=4.0)

    page.wait_for_selector.assert_awaited_once_with("body", state="attached", timeout=5000)
    page.wait_for_timeout.assert_awaited_once_with(1500)


@pytest.mark.asyncio
async def test_goto_falls_back_to_commit_on_domcontentloaded_failure() -> None:
    page = MagicMock()
    page.wait_for_load_state = AsyncMock()
    page.wait_for_selector = AsyncMock()
    page.wait_for_timeout = AsyncMock()

    async def _mock_goto(url: str, *args: object, wait_until: str = "", **kwargs: object) -> None:
        if wait_until == "domcontentloaded":
            raise TimeoutError("domcontentloaded timeout")

    page.goto = AsyncMock(side_effect=_mock_goto)

    await _goto(page, "http://app.local/long-poll")

    assert page.goto.call_count == 2
    page.goto.assert_any_await(
        "http://app.local/long-poll", wait_until="domcontentloaded", timeout=20000
    )
    page.goto.assert_any_await("http://app.local/long-poll", wait_until="commit", timeout=20000)
