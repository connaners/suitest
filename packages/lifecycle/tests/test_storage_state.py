from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from suitest_lifecycle.blackbox.crawler import _discover
from suitest_lifecycle.blackbox.mcp import _resolve
from suitest_lifecycle.blackbox.models import (
    BlackboxAuth,
    BlackboxCrawl,
    BlackboxUiConfig,
)


def test_storage_state_resolution() -> None:
    # From raw config dict
    cfg = BlackboxUiConfig.from_raw(
        {
            "targetUrl": "http://app.local",
            "storageStatePath": "/tmp/custom_state.json",
        }
    )
    assert cfg.storage_state_path == "/tmp/custom_state.json"

    # From MCP _resolve helper
    ui, _ = _resolve(
        url="http://app.local",
        storage_state_path="/tmp/session_state.json",
    )
    assert ui.storage_state_path == "/tmp/session_state.json"


@pytest.mark.asyncio
async def test_discover_bypasses_login_with_valid_storage_state(tmp_path: Path) -> None:
    state_file = tmp_path / "valid_state.json"
    state_file.write_text('{"cookies": [{"name": "sid", "value": "xyz"}]}', encoding="utf-8")

    cfg = BlackboxUiConfig(
        target_url="http://app.local",
        auth=BlackboxAuth(username="user", password="pwd", login_url="/login"),
        crawl=BlackboxCrawl(max_routes=1),
        storage_state_path=str(state_file),
    )

    mock_browser = MagicMock()
    mock_ctx = MagicMock()
    mock_page = MagicMock()

    mock_browser.new_context = AsyncMock(return_value=mock_ctx)
    mock_browser.close = AsyncMock()
    mock_ctx.new_page = AsyncMock(return_value=mock_page)

    mock_page.url = "http://app.local/dashboard"
    mock_page.goto = AsyncMock()
    mock_page.wait_for_load_state = AsyncMock()
    mock_page.wait_for_selector = AsyncMock()
    mock_page.wait_for_timeout = AsyncMock()
    mock_page.screenshot = AsyncMock()
    mock_page.on = MagicMock()

    # Evaluates snapshot for dashboard (no login form found)
    mock_page.evaluate = AsyncMock(
        return_value={
            "title": "App Dashboard",
            "textSample": "Welcome User",
            "elementCount": 15,
            "inputs": [],
            "buttons": [],
            "links": [],
        }
    )

    mock_playwright = MagicMock()
    mock_playwright.chromium.launch = AsyncMock(return_value=mock_browser)

    with patch("playwright.async_api.async_playwright") as pw_patch:
        pw_patch.return_value.__aenter__.return_value = mock_playwright
        res = await _discover(cfg, tmp_path)

    # Context was initialized with storage_state
    mock_browser.new_context.assert_awaited_once_with(
        viewport={"width": 1280, "height": 720},
        storage_state=str(state_file),
    )

    # Login was bypassed and probe recorded authenticated state
    assert res.login_probe.attempted is True
    assert res.login_probe.success is True
    assert "imported storage_state" in res.login_probe.detail
    assert res.storage_state_path == str(state_file)
