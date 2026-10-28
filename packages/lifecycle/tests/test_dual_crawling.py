from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from suitest_lifecycle.blackbox.crawler import _discover
from suitest_lifecycle.blackbox.models import (
    ApiCallInfo,
    BlackboxAuth,
    BlackboxCrawl,
    BlackboxUiConfig,
    DiscoveryResult,
)


def test_api_call_info_serialization() -> None:
    call = ApiCallInfo(
        url="http://api.local/v1/users",
        method="POST",
        status=201,
        resource_type="fetch",
        route="/users",
        request_body='{"name": "test"}',
        response_body='{"id": 42}',
    )
    raw = call.to_json()
    assert raw["url"] == "http://api.local/v1/users"
    assert raw["method"] == "POST"
    assert raw["status"] == 201

    roundtrip = ApiCallInfo.from_json(raw)
    assert roundtrip.url == call.url
    assert roundtrip.response_body == '{"id": 42}'


def test_discovery_result_with_intercepted_api_calls() -> None:
    res = DiscoveryResult(
        base_url="http://app.local",
        intercepted_api_calls=[
            ApiCallInfo(url="http://app.local/api/config", method="GET", status=200),
            ApiCallInfo(url="http://app.local/api/auth", method="POST", status=200),
        ],
    )
    data = res.to_json()
    assert "interceptedApiCalls" in data
    assert len(data["interceptedApiCalls"]) == 2

    loaded = DiscoveryResult.from_json(data)
    assert len(loaded.intercepted_api_calls) == 2
    assert loaded.intercepted_api_calls[0].url == "http://app.local/api/config"


@pytest.mark.asyncio
async def test_discover_intercepts_api_calls_and_writes_artifact(tmp_path: Path) -> None:
    cfg = BlackboxUiConfig(
        target_url="http://portal.local",
        auth=BlackboxAuth(login_url="/"),
        crawl=BlackboxCrawl(max_routes=1),
    )

    mock_browser = MagicMock()
    mock_ctx = MagicMock()
    mock_page = MagicMock()

    mock_browser.new_context = AsyncMock(return_value=mock_ctx)
    mock_browser.close = AsyncMock()
    mock_ctx.new_page = AsyncMock(return_value=mock_page)

    mock_page.url = "http://portal.local/"
    mock_page.goto = AsyncMock()
    mock_page.wait_for_load_state = AsyncMock()
    mock_page.wait_for_selector = AsyncMock()
    mock_page.wait_for_timeout = AsyncMock()
    mock_page.screenshot = AsyncMock()

    # Capture page.on listeners
    listeners: dict[str, list[object]] = {}

    def _mock_on(evt: str, cb: object) -> None:
        listeners.setdefault(evt, []).append(cb)

    mock_page.on = MagicMock(side_effect=_mock_on)

    mock_page.evaluate = AsyncMock(
        return_value={
            "title": "Home",
            "textSample": "Welcome to Portal",
            "elementCount": 10,
            "inputs": [],
            "buttons": [],
            "links": [],
        }
    )

    mock_playwright = MagicMock()
    mock_playwright.chromium.launch = AsyncMock(return_value=mock_browser)

    with patch("playwright.async_api.async_playwright") as pw_patch:
        pw_patch.return_value.__aenter__.return_value = mock_playwright

        # Before crawling completes, simulate an API response event
        async def _trigger_network_event(*_: object, **__: object) -> None:
            # Trigger response listener with a simulated API call
            for cb in listeners.get("response", []):
                req = MagicMock()
                req.url = "http://portal.local/api/v1/permissions"
                req.method = "GET"
                req.resource_type = "fetch"
                req.post_data = ""

                resp = MagicMock()
                resp.url = req.url
                resp.request = req
                resp.status = 200
                resp.headers = {"content-type": "application/json"}
                resp.text = AsyncMock(return_value='{"permissions": ["admin"]}')

                if callable(cb):
                    cb(resp)

        mock_page.goto.side_effect = _trigger_network_event
        res = await _discover(cfg, tmp_path)
        assert res.base_url == "http://portal.local"
    # Verify intercepted_api_calls.json was written to evidence directory
    api_artifact = tmp_path / "intercepted_api_calls.json"
    assert api_artifact.is_file()
    saved_data = json.loads(api_artifact.read_text(encoding="utf-8"))
    assert len(saved_data) >= 1
    assert saved_data[0]["url"] == "http://portal.local/api/v1/permissions"
    assert saved_data[0]["method"] == "GET"
