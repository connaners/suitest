from __future__ import annotations

from unittest.mock import MagicMock

from suitest_lifecycle.tools import _resolve_suite_and_project


def test_resolve_suite_and_project_auto_creates_when_empty():
    mock_client = MagicMock()
    mock_client.resolve_project.return_value = {"id": "proj_123", "slug": "example-com"}
    mock_client.list_suites.return_value = []
    mock_client.create_suite.return_value = {"id": "suite_abc", "name": "General Discovered Suite"}

    p_id, s_id = _resolve_suite_and_project(
        mock_client,
        project_id="",
        suite_id="",
        target_url="http://example.com/login",
    )

    assert p_id == "proj_123"
    assert s_id == "suite_abc"
    mock_client.resolve_project.assert_called_once_with(
        project_slug="example-com",
        project_name="example.com",
    )
    mock_client.list_suites.assert_called_once_with(project_id="proj_123")
    mock_client.create_suite.assert_called_once_with(
        project_id="proj_123",
        name="General Discovered Suite",
    )


def test_resolve_suite_and_project_guards_against_empty_project_id():
    mock_client = MagicMock()
    mock_client.resolve_project.return_value = {}

    p_id, s_id = _resolve_suite_and_project(
        mock_client,
        project_id="",
        suite_id="",
        target_url="",
    )

    assert p_id == ""
    assert s_id == ""
    # Must NOT call list_suites with empty project_id (avoids 422 Unprocessable Entity)
    mock_client.list_suites.assert_not_called()
