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


def test_prune_redundant_step_toggles_handles_selector_argument_and_mixed():
    steps = [
        {
            "action": "Click Nav",
            "code": {"tool": "browser_click", "arguments": {"selector": "#accordion-btn"}},
        },
        {
            "action": "Click Nav Duplicate Target",
            "code": {"tool": "browser.click", "arguments": {"target": "#accordion-btn"}},
        },
        {
            "action": "Click Sub-Item",
            "code": {"tool": "browser_click", "arguments": {"selector": "#sub-item-1"}},
        },
    ]
    cleaned = _prune_redundant_step_toggles(steps)
    assert len(cleaned) == 2
    assert cleaned[0]["action"] == "Click Nav"
    assert cleaned[1]["action"] == "Click Sub-Item"


def test_prune_redundant_step_toggles_safely_handles_non_json_and_non_dict_code():
    steps = [
        {"action": "Raw step 1", "code": ""},
        {"action": "Raw step 2", "code": "page.click('#btn')"},
        {"action": "List step", "code": "[1, 2, 3]"},
        {"action": "None step", "code": None},
    ]
    cleaned = _prune_redundant_step_toggles(steps)
    assert len(cleaned) == 4
