from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from suitest_lifecycle.interactive_browser import (
    INTERACTIVE_BROWSER_TOOLS,
    InteractiveSession,
    InteractiveSessionManager,
    suitest_browser_click,
    suitest_browser_close,
    suitest_browser_navigate,
    suitest_browser_open,
    suitest_browser_select,
    suitest_browser_snapshot,
    suitest_browser_solve_captcha,
    suitest_browser_type,
)
from suitest_lifecycle.mcp_server import _tool_schema


def test_interactive_browser_tool_schemas() -> None:
    expected_tools = [
        "suitest_browser_open",
        "suitest_browser_navigate",
        "suitest_browser_click",
        "suitest_browser_type",
        "suitest_browser_select",
        "suitest_browser_solve_captcha",
        "suitest_browser_snapshot",
        "suitest_browser_close",
    ]
    for name in expected_tools:
        schema = _tool_schema(name)
        assert schema["name"] == name
        assert "inputSchema" in schema
        assert name in INTERACTIVE_BROWSER_TOOLS


def test_session_manager_ttl_reaper() -> None:
    mgr = InteractiveSessionManager()
    mock_pw = MagicMock()
    mock_browser = MagicMock()
    mock_ctx = MagicMock()
    mock_page = MagicMock()

    sess = InteractiveSession(
        session_id="sess_test123",
        playwright_obj=mock_pw,
        browser=mock_browser,
        context=mock_ctx,
        page=mock_page,
    )
    # Simulate expired session (> 300s)
    sess.last_activity = time.time() - 350
    mgr._sessions["sess_test123"] = sess

    assert sess.is_expired(300.0) is True
    reaped = mgr.reap_expired()
    assert reaped == ["sess_test123"]
    assert "sess_test123" not in mgr._sessions
    mock_page.close.assert_called_once()
    mock_browser.close.assert_called_once()


def test_session_manager_concurrency_limit() -> None:
    mgr = InteractiveSessionManager()

    for i in range(3):
        sess_id = f"sess_{i}"
        mgr._sessions[sess_id] = InteractiveSession(
            session_id=sess_id,
            playwright_obj=MagicMock(),
            browser=MagicMock(),
            context=MagicMock(),
            page=MagicMock(),
        )

    # Attempting to open 4th session raises ValueError
    with pytest.raises(ValueError, match="Maximum 3 concurrent browser sessions reached"):
        mgr.open_session()


def test_interactive_tools_e2e_flow(tmp_path: Path) -> None:
    mock_pw = MagicMock()
    mock_browser = MagicMock()
    mock_ctx = MagicMock()
    mock_page = MagicMock()

    mock_pw_context = MagicMock()
    mock_pw_context.start.return_value = mock_pw
    mock_pw.chromium.launch.return_value = mock_browser
    mock_browser.new_context.return_value = mock_ctx
    mock_ctx.new_page.return_value = mock_page

    mock_page.url = "http://enterprise.local/dashboard"
    mock_page.title.return_value = "Enterprise Dashboard"
    mock_page.screenshot.return_value = b"fakepngbytes"
    mock_page.evaluate.return_value = {
        "inputs": [{"name": "txt"}],
        "buttons": [{"text": "Submit"}],
        "hasCaptcha": False,
    }

    mock_loc = MagicMock()
    mock_loc.first = mock_loc
    mock_page.locator.return_value = mock_loc

    with patch("playwright.sync_api.sync_playwright", return_value=mock_pw_context):
        # 1. Open session
        res_open = suitest_browser_open()
        assert res_open["success"] is True
        session_id = res_open["data"]["session_id"]
        assert session_id.startswith("sess_")

        # 2. Navigate
        res_nav = suitest_browser_navigate(
            session_id=session_id, url="http://enterprise.local/login"
        )
        assert res_nav["success"] is True
        mock_page.goto.assert_called_with(
            "http://enterprise.local/login", wait_until="domcontentloaded", timeout=25000
        )

        # 3. Type
        res_type = suitest_browser_type(session_id=session_id, target="#username", text="admin")
        assert res_type["success"] is True
        mock_loc.fill.assert_called_with("admin")

        # 4. Click
        res_click = suitest_browser_click(session_id=session_id, target="#btn-submit")
        assert res_click["success"] is True
        mock_loc.click.assert_called_once()

        # 5. Select
        res_sel = suitest_browser_select(session_id=session_id, target="#role", value="admin_role")
        assert res_sel["success"] is True
        mock_loc.select_option.assert_called_with(value="admin_role")

        # 6. Solve CAPTCHA
        mock_loc.evaluate.return_value = {"status": "solved", "text": "4591", "source": "tiny_ocr"}
        res_cap = suitest_browser_solve_captcha(
            session_id=session_id, image_target="#img-captcha", input_target="#captcha"
        )
        assert res_cap["success"] is True
        assert res_cap["data"]["solved_text"] == "4591"

        # 7. Snapshot
        res_snap = suitest_browser_snapshot(session_id=session_id)
        assert res_snap["success"] is True
        assert "data:image/png;base64," in res_snap["data"]["screenshot_base64"]

        # 8. Close session with save_as_case
        res_close = suitest_browser_close(
            session_id=session_id, save_as_case=True, output_dir=str(tmp_path)
        )
        assert res_close["success"] is True
        assert len(res_close["artifacts"]) == 1
        case_file = Path(res_close["artifacts"][0])
        assert case_file.is_file()
