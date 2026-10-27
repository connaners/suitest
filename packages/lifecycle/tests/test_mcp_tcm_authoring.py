import json
import os
from unittest.mock import MagicMock, patch

from suitest_lifecycle.tools import (
    create_test_case,
    get_test_case,
    list_suites,
    list_test_cases,
    run_test_case,
)


def test_create_test_case_file_and_sync(tmp_path):
    out_dir = tmp_path / "frontend"
    mock_client = MagicMock()
    mock_client.create_case.return_value = {
        "id": "c_mock_123",
        "publicId": "TC-9999",
        "name": "My New Auth Test",
        "steps": [],
    }

    steps = [
        {
            "action": "Open login",
            "code": json.dumps({"tool": "browser_navigate", "arguments": {"url": "/login"}}),
        },
        {
            "action": "Fill User",
            "code": json.dumps(
                {"tool": "browser_type", "arguments": {"target": "#user", "text": "admin"}}
            ),
        },
        {
            "action": "Solve Captcha",
            "code": json.dumps(
                {
                    "tool": "browser_solve_captcha",
                    "arguments": {"image_selector": "#img-captcha", "input_selector": "#captcha"},
                }
            ),
        },
    ]

    with (
        patch.dict(
            os.environ, {"SUITEST_API_URL": "http://mock:4000", "SUITEST_API_KEY": "sk_mock"}
        ),
        patch("suitest_lifecycle.http_client.SuitestClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__enter__.return_value = mock_client
        res = create_test_case(
            suite_id="s_mock_1",
            name="My New Auth Test",
            description="Testing auth flow",
            steps=steps,
            output_dir=str(out_dir),
        )

    assert res["success"] is True
    assert "TC-9999" in str(res["summary"])
    mock_client.create_case.assert_called_once()
    payload = mock_client.create_case.call_args[0][0]
    assert payload["suiteId"] == "s_mock_1"
    assert payload["name"] == "My New Auth Test"
    assert len(payload["steps"]) == 3

    # Verify local file mirror was generated on disk
    expected_file = out_dir / "TC_my_new_auth_test.py"
    assert expected_file.exists()
    content = expected_file.read_text(encoding="utf-8")
    assert "My New Auth Test" in content
    assert "browser.goto" in content or "page.goto" in content
    assert "_bb_solve_captcha" in content


def test_run_test_case_calls_api():
    mock_client = MagicMock()
    mock_client.run_case.return_value = {
        "id": "run_mock_1",
        "publicId": "R-5555",
        "status": "QUEUED",
    }

    with (
        patch.dict(
            os.environ, {"SUITEST_API_URL": "http://mock:4000", "SUITEST_API_KEY": "sk_mock"}
        ),
        patch("suitest_lifecycle.http_client.SuitestClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__enter__.return_value = mock_client
        res = run_test_case(case_id="c_mock_123")

    assert res["success"] is True
    assert "R-5555" in str(res["summary"])
    mock_client.run_case.assert_called_once_with("c_mock_123")


def test_list_suites_and_cases():
    mock_client = MagicMock()
    mock_client.list_suites.return_value = [{"id": "s1", "name": "Auth Suite"}]
    mock_client.list_cases.return_value = [{"id": "c1", "name": "Login Case"}]

    with (
        patch.dict(
            os.environ, {"SUITEST_API_URL": "http://mock:4000", "SUITEST_API_KEY": "sk_mock"}
        ),
        patch("suitest_lifecycle.http_client.SuitestClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__enter__.return_value = mock_client
        res_suites = list_suites(project_id="p1")
        assert res_suites["success"] is True
        assert len(res_suites["data"]["suites"]) == 1
        res_cases = list_test_cases(project_id="p1")
        assert res_cases["success"] is True
        assert len(res_cases["data"]["test_cases"]) == 1


def test_get_test_case():
    mock_client = MagicMock()
    mock_client.get_case.return_value = {"id": "c1", "name": "Login Case", "publicId": "TC-101"}

    with (
        patch.dict(
            os.environ, {"SUITEST_API_URL": "http://mock:4000", "SUITEST_API_KEY": "sk_mock"}
        ),
        patch("suitest_lifecycle.http_client.SuitestClient") as mock_client_cls,
    ):
        mock_client_cls.return_value.__enter__.return_value = mock_client
        res = get_test_case(case_id="c1")
        assert res["success"] is True
        assert res["data"]["publicId"] == "TC-101"
