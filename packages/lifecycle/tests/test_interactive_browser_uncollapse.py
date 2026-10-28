from __future__ import annotations

from unittest.mock import MagicMock

from suitest_lifecycle.interactive_browser import _GLOBAL_MANAGER, suitest_browser_click


def test_interactive_browser_click_uncollapses_parent_and_records_both():
    mock_session = MagicMock()
    mock_session.session_id = "sess_mock_uncollapse"
    mock_session._closed = False
    mock_session.is_expired.return_value = False
    mock_session.action_history = []

    # Mock page.locator
    mock_loc = MagicMock()
    mock_loc.first = mock_loc
    # 1. target.is_visible() -> False (hidden in collapsed menu)
    # 2. toggle.is_visible() -> True (parent toggle is visible)
    # 3. target after uncollapse -> True
    mock_loc.is_visible.side_effect = [False, True, True]
    mock_session.page.locator.return_value = mock_loc

    # Mock evaluate returning toggleSelector
    mock_session.page.evaluate.return_value = {
        "toggleSelector": '.kt-menu__toggle:has-text("PKKPRL")'
    }

    def record_action(act, **kwargs):
        mock_session.action_history.append({"action": act, **kwargs})

    mock_session.record_action.side_effect = record_action

    _GLOBAL_MANAGER._sessions["sess_mock_uncollapse"] = mock_session

    try:
        res = suitest_browser_click(
            session_id="sess_mock_uncollapse",
            target='a:has-text("Daftar Permohonan")',
        )
        assert res["success"] is True
        # Verify both toggle and target were recorded
        assert len(mock_session.action_history) == 2
        assert mock_session.action_history[0]["action"] == "click"
        assert mock_session.action_history[0]["target"] == '.kt-menu__toggle:has-text("PKKPRL")'
        assert mock_session.action_history[1]["action"] == "click"
        assert mock_session.action_history[1]["target"] == 'a:has-text("Daftar Permohonan")'
    finally:
        _GLOBAL_MANAGER._sessions.pop("sess_mock_uncollapse", None)
