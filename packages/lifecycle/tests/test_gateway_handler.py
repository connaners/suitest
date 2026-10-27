from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from suitest_lifecycle.blackbox.crawler import _handle_gateway
from suitest_lifecycle.blackbox.mcp import blackbox_handle_gateway
from suitest_lifecycle.blackbox.models import BlackboxUiConfig
from suitest_lifecycle.mcp_server import _tool_schema


def test_gateway_schema() -> None:
    schema = _tool_schema("blackbox_handle_gateway")
    assert schema["name"] == "blackbox_handle_gateway"
    input_schema = schema["inputSchema"]
    assert isinstance(input_schema, dict)
    assert input_schema.get("required") == ["action_trigger"]
    props = input_schema.get("properties", {})
    assert "gateway_type" in props
    assert "action_trigger" in props
    assert "target_value" in props


def test_blackbox_handle_gateway_missing_trigger() -> None:
    res = blackbox_handle_gateway(action_trigger="")
    assert res["success"] is False
    assert "action_trigger is required" in res["errors"]


@pytest.mark.asyncio
async def test_handle_gateway_flow(tmp_path: Path) -> None:
    cfg = BlackboxUiConfig(target_url="http://enterprise.local/login")

    mock_browser = MagicMock()
    mock_ctx = MagicMock()
    mock_page = MagicMock()

    mock_browser.new_context = AsyncMock(return_value=mock_ctx)
    mock_browser.close = AsyncMock()
    mock_ctx.new_page = AsyncMock(return_value=mock_page)
    mock_ctx.storage_state = AsyncMock()

    mock_page.url = "http://enterprise.local/dashboard"
    mock_page.goto = AsyncMock()
    mock_page.wait_for_load_state = AsyncMock()
    mock_page.wait_for_selector = AsyncMock()
    mock_page.wait_for_timeout = AsyncMock()
    mock_page.screenshot = AsyncMock()
    mock_page.on = MagicMock()

    mock_trigger = MagicMock()
    mock_trigger.wait_for = AsyncMock()
    mock_trigger.click = AsyncMock()
    mock_trigger.first = mock_trigger

    mock_input = MagicMock()
    mock_input.count = AsyncMock(return_value=1)
    mock_input.fill = AsyncMock()
    mock_input.first = mock_input

    def _mock_locator(selector: str) -> MagicMock:
        if selector == "button[data-code='3100']":
            return mock_trigger
        return mock_input

    mock_page.locator = MagicMock(side_effect=_mock_locator)

    mock_playwright = MagicMock()
    mock_playwright.chromium.launch = AsyncMock(return_value=mock_browser)

    with patch("playwright.async_api.async_playwright") as pw_patch:
        pw_patch.return_value.__aenter__.return_value = mock_playwright
        res = await _handle_gateway(
            cfg,
            tmp_path,
            "button[data-code='3100']",
            gateway_type="role_or_tenant",
            target_value="DIR_3100",
        )

    assert res["success"] is True
    assert res["gateway_type"] == "role_or_tenant"
    assert res["action_trigger"] == "button[data-code='3100']"
    assert res["landed_route"] == "/dashboard"

    mock_trigger.wait_for.assert_awaited_once_with(state="visible", timeout=10000)
    mock_trigger.click.assert_awaited_once()
    mock_input.fill.assert_awaited_once_with("DIR_3100")
