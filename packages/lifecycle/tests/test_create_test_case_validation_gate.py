from __future__ import annotations

from suitest_lifecycle.tools import _prune_redundant_step_toggles


def test_prune_redundant_step_toggles_removes_immediate_duplicate_clicks():
    steps = [
        {
            "action": "Click Nav",
            "code": {"tool": "browser_click", "arguments": {"target": "#accordion-btn"}},
        },
        {
            "action": "Click Nav Duplicate",
            "code": {"tool": "browser_click", "arguments": {"target": "#accordion-btn"}},
        },
        {
            "action": "Click Sub-Item",
            "code": {"tool": "browser_click", "arguments": {"target": "#sub-item-1"}},
        },
    ]
    cleaned = _prune_redundant_step_toggles(steps)
    assert len(cleaned) == 2
    assert cleaned[0]["code"]["arguments"]["target"] == "#accordion-btn"
    assert cleaned[1]["code"]["arguments"]["target"] == "#sub-item-1"
