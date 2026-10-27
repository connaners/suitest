"""Stateful Interactive Browser Session Manager and MCP Tools (Task 8 / Pilar 4).

Provides step-by-step interactive browser control for LLMs/Agents with:
- Per-session lifecycle (session_id)
- Inactivity TTL Reaper (300 seconds default)
- Concurrency limiter (max 3 active sessions)
- Complete action traceability (recording action_history for TCM export)
- In-browser Tiny OCR CAPTCHA solving
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from suitest_shared.ocr import (
    build_tiny_ocr_element_eval_script,
    classify_ocr_output,
)

from suitest_lifecycle.tool_result import envelope as _envelope

logger = logging.getLogger(__name__)


@dataclass
class BrowserAction:
    order: int
    action: str
    target: str = ""
    value: str = ""
    timestamp: float = field(default_factory=time.time)
    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "order": self.order,
            "action": self.action,
            "target": self.target,
            "value": self.value,
            "timestamp": self.timestamp,
            **self.extra,
        }


class InteractiveSession:
    """Encapsulates a live, stateful Playwright browser session."""

    def __init__(
        self,
        session_id: str,
        playwright_obj: Any,
        browser: Any,
        context: Any,
        page: Any,
    ) -> None:
        self.session_id = session_id
        self.playwright = playwright_obj
        self.browser = browser
        self.context = context
        self.page = page
        self.created_at = time.time()
        self.last_activity = time.time()
        self.action_history: list[BrowserAction] = []
        self._closed = False

    def touch(self) -> None:
        self.last_activity = time.time()

    def is_expired(self, ttl_seconds: float = 300.0) -> bool:
        return (time.time() - self.last_activity) > ttl_seconds

    def record_action(
        self,
        action: str,
        target: str = "",
        value: str = "",
        **extra: Any,
    ) -> None:
        self.touch()
        order = len(self.action_history) + 1
        self.action_history.append(
            BrowserAction(
                order=order,
                action=action,
                target=target,
                value=value,
                extra=extra,
            )
        )

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(Exception):
            self.page.close()
        with contextlib.suppress(Exception):
            self.context.close()
        with contextlib.suppress(Exception):
            self.browser.close()
        with contextlib.suppress(Exception):
            self.playwright.stop()


class InteractiveSessionManager:
    """Manages active interactive browser sessions with concurrency cap and TTL reaper."""

    MAX_SESSIONS = 3
    DEFAULT_TTL = 300.0  # 5 minutes

    def __init__(self) -> None:
        self._sessions: dict[str, InteractiveSession] = {}

    def reap_expired(self) -> list[str]:
        """Close and remove sessions that exceeded inactivity TTL."""
        expired_ids: list[str] = []
        for sess_id, sess in list(self._sessions.items()):
            if sess.is_expired(self.DEFAULT_TTL):
                logger.info("interactive_browser.session_expired", session_id=sess_id)
                sess.close()
                del self._sessions[sess_id]
                expired_ids.append(sess_id)
        return expired_ids

    def open_session(
        self,
        headless: bool = True,
        viewport: dict[str, int] | None = None,
        storage_state_path: str = "",
    ) -> str:
        self.reap_expired()
        if len(self._sessions) >= self.MAX_SESSIONS:
            raise ValueError(
                f"Maximum {self.MAX_SESSIONS} concurrent browser sessions reached. "
                "Close an active session using suitest_browser_close."
            )

        from playwright.sync_api import sync_playwright

        vp = viewport or {"width": 1280, "height": 800}
        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=headless)

        context_kwargs: dict[str, Any] = {"viewport": vp}
        if storage_state_path and Path(storage_state_path).is_file():
            context_kwargs["storage_state"] = str(storage_state_path)

        ctx = browser.new_context(**context_kwargs)
        page = ctx.new_page()

        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        session = InteractiveSession(
            session_id=session_id,
            playwright_obj=pw,
            browser=browser,
            context=ctx,
            page=page,
        )
        self._sessions[session_id] = session
        return session_id

    def get_session(self, session_id: str) -> InteractiveSession:
        self.reap_expired()
        session = self._sessions.get(session_id)
        if not session or session._closed:
            raise ValueError(
                f"Browser session '{session_id}' not found or has expired (TTL {int(self.DEFAULT_TTL)}s)."
            )
        session.touch()
        return session

    def close_session(
        self,
        session_id: str,
        save_as_case: bool = False,
        output_dir: str = "suitest-output/cases",
    ) -> tuple[list[dict[str, Any]], str]:
        session = self._sessions.pop(session_id, None)
        if not session:
            return [], ""

        actions = [a.to_json() for a in session.action_history]
        session.close()

        case_file = ""
        if save_as_case and actions:
            out_path = Path(output_dir)
            out_path.mkdir(parents=True, exist_ok=True)
            case_file = str(out_path / f"{session_id}.case.json")
            payload = {
                "session_id": session_id,
                "recorded_at": session.created_at,
                "steps": [
                    {
                        "order": a["order"],
                        "action": a["action"],
                        "target": a.get("target", ""),
                        "value": a.get("value", ""),
                    }
                    for a in actions
                ],
            }
            Path(case_file).write_text(json.dumps(payload, indent=2), encoding="utf-8")

        return actions, case_file

    def close_all(self) -> None:
        for sess in self._sessions.values():
            sess.close()
        self._sessions.clear()


# Global module singleton for the MCP stdio runtime process
_GLOBAL_MANAGER = InteractiveSessionManager()


# --------------------------------------------------------------------------- #
# MCP Tool Implementations
# --------------------------------------------------------------------------- #


def suitest_browser_open(
    headless: bool = True,
    viewport: dict[str, int] | None = None,
    storage_state_path: str = "",
    **_: Any,
) -> dict[str, Any]:
    """Open a new stateful interactive browser session."""
    try:
        session_id = _GLOBAL_MANAGER.open_session(
            headless=headless,
            viewport=viewport,
            storage_state_path=storage_state_path,
        )
        return _envelope(
            success=True,
            summary=f"Opened interactive browser session '{session_id}'",
            data={"session_id": session_id},
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Failed to open browser session: {exc}",
            errors=[str(exc)],
        )


def suitest_browser_navigate(
    session_id: str = "",
    url: str = "",
    wait_strategy: str = "domcontentloaded",
    **_: Any,
) -> dict[str, Any]:
    """Navigate to a target URL in the specified interactive session."""
    if not session_id or not url:
        return _envelope(
            False, "session_id and url are required", errors=["missing required parameters"]
        )
    try:
        sess = _GLOBAL_MANAGER.get_session(session_id)
        # Playwright wait_until accepts: 'load', 'domcontentloaded', 'networkidle', 'commit'
        strategy = (
            wait_strategy
            if wait_strategy in ("load", "domcontentloaded", "networkidle", "commit")
            else "domcontentloaded"
        )
        sess.page.goto(url, wait_until=strategy, timeout=25000)
        curr_url = sess.page.url
        title = sess.page.title()
        sess.record_action("navigate", target="", value=url, current_url=curr_url, title=title)
        return _envelope(
            success=True,
            summary=f"Navigated to '{url}' — landed on '{curr_url}'",
            data={"session_id": session_id, "url": curr_url, "title": title},
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Navigation failed on session '{session_id}': {exc}",
            errors=[str(exc)],
        )


def suitest_browser_click(
    session_id: str = "",
    target: str = "",
    timeout_ms: int = 10000,
    **_: Any,
) -> dict[str, Any]:
    """Click an element matching selector in the interactive session."""
    if not session_id or not target:
        return _envelope(
            False, "session_id and target selector are required", errors=["missing parameters"]
        )
    try:
        sess = _GLOBAL_MANAGER.get_session(session_id)
        loc = sess.page.locator(target)
        if hasattr(loc, "first"):
            loc = loc.first
        loc.wait_for(state="visible", timeout=timeout_ms)
        loc.click()
        sess.record_action("click", target=target)
        return _envelope(
            success=True,
            summary=f"Clicked '{target}'",
            data={"session_id": session_id, "target": target},
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Click failed on '{target}': {exc}",
            errors=[str(exc)],
        )


def suitest_browser_type(
    session_id: str = "",
    target: str = "",
    text: str = "",
    timeout_ms: int = 10000,
    **_: Any,
) -> dict[str, Any]:
    """Fill text into an input or textarea matching selector."""
    if not session_id or not target:
        return _envelope(False, "session_id and target are required", errors=["missing parameters"])
    try:
        sess = _GLOBAL_MANAGER.get_session(session_id)
        loc = sess.page.locator(target)
        if hasattr(loc, "first"):
            loc = loc.first
        loc.wait_for(state="visible", timeout=timeout_ms)
        loc.fill(text)
        sess.record_action("type", target=target, value=text)
        return _envelope(
            success=True,
            summary=f"Typed text into '{target}'",
            data={"session_id": session_id, "target": target},
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Type failed on '{target}': {exc}",
            errors=[str(exc)],
        )


def suitest_browser_select(
    session_id: str = "",
    target: str = "",
    value: str = "",
    timeout_ms: int = 10000,
    **_: Any,
) -> dict[str, Any]:
    """Select an option in a select dropdown matching selector."""
    if not session_id or not target:
        return _envelope(False, "session_id and target are required", errors=["missing parameters"])
    try:
        sess = _GLOBAL_MANAGER.get_session(session_id)
        loc = sess.page.locator(target)
        if hasattr(loc, "first"):
            loc = loc.first
        loc.wait_for(state="visible", timeout=timeout_ms)
        loc.select_option(value=value)
        sess.record_action("select", target=target, value=value)
        return _envelope(
            success=True,
            summary=f"Selected '{value}' in '{target}'",
            data={"session_id": session_id, "target": target, "value": value},
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Select failed on '{target}': {exc}",
            errors=[str(exc)],
        )


def suitest_browser_solve_captcha(
    session_id: str = "",
    image_target: str = "#img-captcha",
    input_target: str = "#captcha",
    **_: Any,
) -> dict[str, Any]:
    """Locally decode and solve CAPTCHA in the active session."""
    if not session_id:
        return _envelope(False, "session_id is required", errors=["missing session_id"])
    try:
        sess = _GLOBAL_MANAGER.get_session(session_id)
        img_loc = sess.page.locator(image_target)
        if hasattr(img_loc, "first"):
            img_loc = img_loc.first
        img_loc.wait_for(state="visible", timeout=8000)

        eval_script = build_tiny_ocr_element_eval_script()
        res = img_loc.evaluate(eval_script)

        solved_text = ""
        source = "tiny_ocr"
        if isinstance(res, dict) and res.get("status") == "solved":
            solved_text = str(res.get("text") or "")
            source = str(res.get("source") or "tiny_ocr")

        if not solved_text:
            classified = classify_ocr_output(str(res.get("rawOcr") or ""))
            if classified.get("status") == "solved":
                solved_text = str(classified.get("text") or "")
                source = str(classified.get("source") or "local_math")

        filled = False
        if solved_text and input_target:
            with contextlib.suppress(Exception):
                inp = sess.page.locator(input_target)
                if hasattr(inp, "first"):
                    inp = inp.first
                inp.fill(solved_text)
                filled = True

        sess.record_action(
            "solve_captcha",
            target=image_target,
            value=solved_text,
            input_target=input_target,
            filled=filled,
        )

        return _envelope(
            success=bool(solved_text),
            summary=(
                f"CAPTCHA solved: '{solved_text}' ({source})"
                if solved_text
                else "CAPTCHA could not be solved locally"
            ),
            data={
                "session_id": session_id,
                "solved_text": solved_text,
                "source": source,
                "filled": filled,
            },
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"CAPTCHA solve failed: {exc}",
            errors=[str(exc)],
        )


def suitest_browser_snapshot(
    session_id: str = "",
    include_screenshot: bool = True,
    **_: Any,
) -> dict[str, Any]:
    """Capture structured page snapshot (URL, inputs, buttons, screenshot base64)."""
    if not session_id:
        return _envelope(False, "session_id is required", errors=["missing session_id"])
    try:
        sess = _GLOBAL_MANAGER.get_session(session_id)
        from suitest_lifecycle.blackbox.crawler import _EXTRACT_JS

        data = sess.page.evaluate(_EXTRACT_JS)
        b64_shot = ""
        if include_screenshot:
            with contextlib.suppress(Exception):
                raw_bytes = sess.page.screenshot(type="png")
                b64_shot = "data:image/png;base64," + base64.b64encode(raw_bytes).decode("ascii")

        sess.touch()
        return _envelope(
            success=True,
            summary=f"Snapshot captured: '{sess.page.title()}' ({sess.page.url})",
            data={
                "session_id": session_id,
                "url": sess.page.url,
                "title": sess.page.title(),
                "inputs_count": len(data.get("inputs", [])),
                "buttons_count": len(data.get("buttons", [])),
                "has_captcha": bool(data.get("hasCaptcha")),
                "inputs": data.get("inputs", []),
                "buttons": data.get("buttons", []),
                "screenshot_base64": b64_shot,
            },
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Snapshot failed: {exc}",
            errors=[str(exc)],
        )


def suitest_browser_close(
    session_id: str = "",
    save_as_case: bool = False,
    output_dir: str = "suitest-output/cases",
    **_: Any,
) -> dict[str, Any]:
    """Close an active interactive browser session, optionally saving action trace."""
    if not session_id:
        return _envelope(False, "session_id is required", errors=["missing session_id"])
    try:
        actions, case_file = _GLOBAL_MANAGER.close_session(
            session_id,
            save_as_case=save_as_case,
            output_dir=output_dir,
        )
        artifacts = [case_file] if case_file else []
        return _envelope(
            success=True,
            summary=f"Closed browser session '{session_id}' (recorded {len(actions)} actions)",
            data={"session_id": session_id, "actions_count": len(actions)},
            artifacts=artifacts,
        )
    except Exception as exc:
        return _envelope(
            success=False,
            summary=f"Failed to close session: {exc}",
            errors=[str(exc)],
        )


INTERACTIVE_BROWSER_TOOLS = {
    "suitest_browser_open": suitest_browser_open,
    "suitest_browser_navigate": suitest_browser_navigate,
    "suitest_browser_click": suitest_browser_click,
    "suitest_browser_type": suitest_browser_type,
    "suitest_browser_select": suitest_browser_select,
    "suitest_browser_solve_captcha": suitest_browser_solve_captcha,
    "suitest_browser_snapshot": suitest_browser_snapshot,
    "suitest_browser_close": suitest_browser_close,
}

__all__ = [
    "INTERACTIVE_BROWSER_TOOLS",
    "InteractiveSession",
    "InteractiveSessionManager",
    "suitest_browser_click",
    "suitest_browser_close",
    "suitest_browser_navigate",
    "suitest_browser_open",
    "suitest_browser_select",
    "suitest_browser_snapshot",
    "suitest_browser_solve_captcha",
    "suitest_browser_type",
]
