from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from suitest_lifecycle.blackbox.crawler import _discover, _solve_captcha_for_form
from suitest_lifecycle.blackbox.models import (
    BlackboxAuth,
    BlackboxCrawl,
    BlackboxUiConfig,
    LoginForm,
    PageInfo,
)


@pytest.mark.asyncio
async def test_solve_captcha_for_form_no_captcha() -> None:
    page = MagicMock()
    form = LoginForm(username="user", password="pwd", submit="submit")
    login_page = PageInfo(route="/login")
    result = await _solve_captcha_for_form(page, form, login_page)
    assert result == ""


@pytest.mark.asyncio
async def test_solve_captcha_for_form_solved() -> None:
    page = MagicMock()
    form = LoginForm(
        username="user",
        password="pwd",
        submit="submit",
        captcha_input="#captcha",
        captcha_image="#img-captcha",
    )
    login_page = PageInfo(route="/login", captcha_image_selector="#img-captcha")

    with patch(
        "suitest_lifecycle.blackbox.crawler.solve_captcha_in_page",
        new=AsyncMock(return_value={"status": "solved", "text": "KAPUAS", "source": "tiny_ocr"}),
    ):
        result = await _solve_captcha_for_form(page, form, login_page)
        assert result == "KAPUAS"


@pytest.mark.asyncio
async def test_solve_captcha_for_form_fallback_graceful() -> None:
    page = MagicMock()
    form = LoginForm(
        username="user",
        password="pwd",
        submit="submit",
        captcha_input="#captcha",
        captcha_image="#img-captcha",
    )
    login_page = PageInfo(route="/login")

    with patch(
        "suitest_lifecycle.blackbox.crawler.solve_captcha_in_page",
        new=AsyncMock(return_value={"status": "fallback", "reason": "noisy"}),
    ):
        result = await _solve_captcha_for_form(page, form, login_page)
        assert result == "CAPTCHA_SOLVE"


@pytest.mark.asyncio
async def test_discover_with_captcha_retry_flow(tmp_path: Path) -> None:
    cfg = BlackboxUiConfig(
        target_url="http://portal.local",
        auth=BlackboxAuth(username="testuser", password="secretpassword"),
        crawl=BlackboxCrawl(max_routes=1),
    )

    # Mock playwright
    mock_browser = MagicMock()
    mock_ctx = MagicMock()
    mock_page = MagicMock()

    mock_browser.new_context = AsyncMock(return_value=mock_ctx)
    mock_browser.close = AsyncMock()
    mock_ctx.new_page = AsyncMock(return_value=mock_page)
    mock_ctx.storage_state = AsyncMock()

    mock_page.url = "http://portal.local/login"
    mock_page.goto = AsyncMock()
    mock_page.wait_for_load_state = AsyncMock()
    mock_page.wait_for_selector = AsyncMock()
    mock_page.wait_for_timeout = AsyncMock()
    mock_page.wait_for_url = AsyncMock()
    mock_page.screenshot = AsyncMock()
    mock_page.on = MagicMock()

    # Sequence: 1st submit stays on /login, 2nd submit redirects to /dashboard
    urls = [
        "http://portal.local/login",
        "http://portal.local/login",
        "http://portal.local/dashboard",
        "http://portal.local/dashboard",
    ]

    def _get_url() -> str:
        if urls:
            return urls.pop(0)
        return "http://portal.local/dashboard"

    type(mock_page).url = property(lambda self: _get_url())

    mock_locator = MagicMock()
    mock_locator.fill = AsyncMock()
    mock_locator.click = AsyncMock()
    mock_locator.count = AsyncMock(return_value=1)
    mock_locator.first = mock_locator
    mock_page.locator = MagicMock(return_value=mock_locator)
    mock_page.get_by_role = MagicMock(return_value=mock_locator)
    mock_page.get_by_label = MagicMock(return_value=mock_locator)
    mock_page.get_by_placeholder = MagicMock(return_value=mock_locator)
    mock_page.get_by_test_id = MagicMock(return_value=mock_locator)
    # Evaluate extracts DOM login elements with captcha
    mock_page.evaluate = AsyncMock(
        side_effect=[
            # 1. _EXTRACT_JS for initial login page
            {
                "title": "Portal Login",
                "hasCaptcha": True,
                "captchaInputSelector": "#captcha",
                "captchaImageSelector": "#img-captcha",
                "refreshTarget": "#img-captcha",
                "inputs": [
                    {"name": "username", "tag": "input", "input_type": "text"},
                    {"name": "password", "tag": "input", "input_type": "password"},
                    {"name": "captcha", "tag": "input", "input_type": "text", "dom_id": "captcha"},
                ],
                "buttons": [{"text": "Log In", "tag": "button", "input_type": "submit"}],
            },
            # 2. evaluate alert error on attempt 1
            "Kode captcha salah",
            # 3. _EXTRACT_JS for dashboard page after landing
            {
                "title": "Dashboard",
                "textSample": "Welcome to Enterprise Dashboard",
                "elementCount": 10,
                "inputs": [],
                "buttons": [],
                "links": [],
            },
        ]
    )

    # Mock storage_state.json write
    def _fake_storage_state(path: str) -> None:
        Path(path).write_text("{}", encoding="utf-8")

    mock_ctx.storage_state.side_effect = _fake_storage_state

    mock_playwright = MagicMock()
    mock_playwright.chromium.launch = AsyncMock(return_value=mock_browser)

    with (
        patch("playwright.async_api.async_playwright") as pw_patch,
        patch(
            "suitest_lifecycle.blackbox.crawler.solve_captcha_in_page",
            new=AsyncMock(return_value={"status": "solved", "text": "9812", "source": "tiny_ocr"}),
        ),
    ):
        pw_patch.return_value.__aenter__.return_value = mock_playwright
        res = await _discover(cfg, tmp_path)

    assert res.login_probe.attempted is True
    assert res.login_probe.success is True
    assert res.login_probe.landed_route == "/dashboard"
    assert res.storage_state_path != ""
