from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from suitest_lifecycle.failure_context import (
    FailedCase,
    build_failure_markdown,
    suggest_selectors,
)
from suitest_lifecycle.tools import get_failure_context


def test_suggest_selectors_from_dom_attributes() -> None:
    dom = """
    <div class="card-body">
      <input type="text" name="email_field" data-testid="user-email-input" placeholder="Enter work email">
      <button class="btn btn-primary" aria-label="Submit Form" id="submit-button">Send</button>
    </div>
    """
    suggestions = suggest_selectors(failed_selector="#submit-btn", dom=dom)
    assert len(suggestions) <= 3
    assert any("submit" in s.lower() or "button" in s.lower() for s in suggestions)


def test_suggest_selectors_fallback_heuristics() -> None:
    sugs = suggest_selectors("#login-submit-btn", dom="")
    assert len(sugs) <= 3
    assert any('name="login-submit-btn"' in s or "login-submit-btn" in s for s in sugs)


def test_build_failure_markdown_includes_suggestions() -> None:
    case = FailedCase(
        title="Login Test",
        failed_step_index=2,
        total_steps=4,
        step_description="Click submit button",
        error_message="TimeoutError: element #btn-submit not found",
        failed_selector="#btn-submit",
        suggested_selectors=[
            'page.get_by_role("button", name="Submit")',
            'page.get_by_test_id("submit-btn")',
            'button[type="submit"]',
        ],
    )
    md = build_failure_markdown([case])
    assert "**Suggested Selectors (Self-Healing)**:" in md
    assert 'page.get_by_role("button", name="Submit")' in md
    assert 'page.get_by_test_id("submit-btn")' in md


def test_get_failure_context_envelope_exposes_suggested_selectors(tmp_path: Path) -> None:
    rep_dir = tmp_path / "reports"
    rep_dir.mkdir(parents=True, exist_ok=True)
    summary_file = rep_dir / "summary.json"
    summary_file.write_text(
        """{
        "mode": "frontend",
        "results": [
            {
                "testId": "TC001",
                "title": "Checkout Flow",
                "status": "FAILED",
                "error": "TimeoutError: element #pay-now not found",
                "steps": [{"index": 1, "description": "Click pay", "status": "FAILED"}]
            }
        ]
    }""",
        encoding="utf-8",
    )

    mock_cfg = MagicMock()
    mock_cfg.output_dir = tmp_path
    mock_cfg.mode = MagicMock()

    with patch("suitest_lifecycle.tools._safe_load", return_value=(mock_cfg, None)):
        res = get_failure_context("dummy.config.json")

    assert res["success"] is True
    data = res["data"]
    assert data["failed_cases"] == 1
    assert "cases" in data
    failed_case = data["cases"][0]
    assert failed_case["title"] == "Checkout Flow"
    assert "suggested_selectors" in failed_case
