"""Tests for enhanced MCP blackbox capabilities:
- Iframe selector detection & frameLocator generation
- CAPTCHA detection & solve_captcha step generation
- Multi-file upload detection & step generation
- edit_test_case_inputs tool functionality & MCP server exposure
"""

from __future__ import annotations

import json
from pathlib import Path

from suitest_lifecycle.blackbox.detector import detect_captcha_form, detect_login_form
from suitest_lifecycle.blackbox.generator import generate_cases
from suitest_lifecycle.blackbox.models import (
    BlackboxUiConfig,
    DiscoveryResult,
    ElementInfo,
    PageInfo,
)
from suitest_lifecycle.blackbox.selector import build_locator
from suitest_lifecycle.mcp_server import handle
from suitest_lifecycle.tools import edit_test_case_inputs


def test_iframe_locator_generation() -> None:
    el = ElementInfo(
        tag="input",
        input_type="email",
        label="Email Address",
        dom_id="user-email",
        frame_selector="iframe#auth-frame",
    )
    loc = build_locator(el)
    assert loc.startswith('page.frame_locator("iframe#auth-frame").')
    assert 'get_by_label("Email Address")' in loc


def test_iframe_login_form_detection() -> None:
    page = PageInfo(
        route="/login",
        inputs=[
            ElementInfo(
                tag="input",
                input_type="email",
                dom_id="login-email",
                name="email",
                frame_selector="iframe#login-frame",
            ),
            ElementInfo(
                tag="input",
                input_type="password",
                dom_id="login-pass",
                name="password",
                frame_selector="iframe#login-frame",
            ),
        ],
        buttons=[
            ElementInfo(
                tag="button",
                input_type="submit",
                dom_id="login-submit",
                text="Sign In",
                frame_selector="iframe#login-frame",
            )
        ],
    )
    form = detect_login_form(page)
    assert form.found()
    assert 'page.frame_locator("iframe#login-frame")' in form.username
    assert 'page.frame_locator("iframe#login-frame")' in form.password
    assert 'page.frame_locator("iframe#login-frame")' in form.submit


def test_captcha_detection_and_step_generation() -> None:
    page = PageInfo(
        route="/register",
        has_form=True,
        pattern="form",
        inputs=[
            ElementInfo(tag="input", input_type="text", name="username"),
            ElementInfo(tag="input", input_type="password", name="password"),
            ElementInfo(
                tag="input",
                input_type="text",
                dom_id="captcha_code",
                name="captcha_code",
                placeholder="Enter CAPTCHA",
            ),
        ],
        buttons=[ElementInfo(tag="button", input_type="submit", text="Register")],
        has_captcha=True,
        captcha_input_selector="#captcha_code",
        captcha_image_selector="#img-captcha",
    )

    has_c, c_in, c_img, _, _ = detect_captcha_form(page)
    assert has_c
    assert c_in == "#captcha_code"
    assert c_img == "#img-captcha"

    cfg = BlackboxUiConfig(target_url="http://test.local")
    discovery = DiscoveryResult(base_url="http://test.local", pages=[page])
    cases = generate_cases(discovery, cfg)

    titles = [c.title for c, _ in cases]
    assert any("captcha" in t for t in titles)
    captcha_body = next(body for c, body in cases if "captcha" in c.title)
    assert "page.locator" in captcha_body and "#captcha_code" in captcha_body
    assert "TEST_CAPTCHA" in captcha_body


def test_multi_file_upload_step_generation() -> None:
    page = PageInfo(
        route="/upload",
        has_form=True,
        pattern="form",
        inputs=[
            ElementInfo(
                tag="input",
                input_type="file",
                dom_id="docs_uploader",
                name="documents",
                is_multiple=True,
            ),
            ElementInfo(tag="input", input_type="text", name="title"),
        ],
        buttons=[ElementInfo(tag="button", input_type="submit", text="Upload Documents")],
    )

    cfg = BlackboxUiConfig(target_url="http://test.local")
    discovery = DiscoveryResult(base_url="http://test.local", pages=[page])
    cases = generate_cases(discovery, cfg)

    titles = [c.title for c, _ in cases]
    assert any("file_upload" in t and "multiple_files" in t for t in titles)

    upload_body = next(body for c, body in cases if "multiple_files" in c.title)
    assert "upload_files = [f1, f2]" in upload_body
    assert "set_input_files(upload_files)" in upload_body


def test_edit_test_case_inputs_tool(tmp_path: Path) -> None:
    out_dir = tmp_path / "suitest-output"
    fe_dir = out_dir / "frontend"
    fe_dir.mkdir(parents=True, exist_ok=True)

    test_file = fe_dir / "TC001_submit_form.py"
    initial_code = """
async def _body(page):
    _begin("action", "Fill the username and password")
    await page.locator("#username").fill("old_user@test.com")
    await page.locator("#password").fill("old_password_123")
    await _ok(page)
    _begin("action", "Upload documents")
    upload_files = ["old_file.pdf"]
    await page.locator("#file-input").set_input_files(upload_files)
    await _ok(page)
    _begin("action", "Select role")
    await page.locator("#role-select").select_option("viewer")
    await _ok(page)
"""
    test_file.write_text(initial_code, encoding="utf-8")

    plan_file = out_dir / "test_plan.json"
    plan_file.write_text(
        json.dumps([{"id": "TC001", "title": "submit_form", "automationFile": test_file.name}]),
        encoding="utf-8",
    )

    # 1. Inspect inputs
    res_get = edit_test_case_inputs(
        case_id="TC001",
        action="get",
        output_dir=str(out_dir),
    )
    assert res_get["success"] is True
    data = res_get["data"]
    assert isinstance(data, dict)
    inputs = data.get("inputs", [])
    assert len(inputs) == 4
    assert inputs[0]["current_value"] == "old_user@test.com"
    assert inputs[1]["type"] == "password"
    assert inputs[2]["type"] == "file_upload"
    assert inputs[3]["type"] == "select"

    # 2. Update inputs with variables and multiple files
    updates = [
        {"step_order": 1, "input_value": "{{user_email}}"},
        {"step_order": 2, "input_value": "{{user_password}}"},
        {"step_order": 3, "file_paths": ["doc1.png", "doc2.png"]},
        {"step_order": 4, "input_value": "admin"},
    ]
    res_upd = edit_test_case_inputs(
        case_id="TC001",
        action="update",
        updates=updates,
        output_dir=str(out_dir),
    )
    assert res_upd["success"] is True
    assert res_upd["data"]["updated_count"] == 4  # type: ignore[index]

    # Verify updated file content and syntax
    updated_code = test_file.read_text(encoding="utf-8")
    assert 'await page.locator("#username").fill("{{user_email}}")' in updated_code
    assert 'await page.locator("#password").fill("{{user_password}}")' in updated_code
    assert 'upload_files = ["doc1.png", "doc2.png"]' in updated_code
    assert 'await page.locator("#role-select").select_option("admin")' in updated_code

    # Must compile without syntax error
    compile(updated_code, str(test_file), "exec")


def test_edit_test_case_inputs_in_mcp_server(tmp_path: Path) -> None:
    # 1. tools/list exposes edit_test_case_inputs
    list_msg = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    resp = handle(list_msg)
    assert resp is not None
    tools = resp["result"]["tools"]  # type: ignore[index]
    edit_tool = next((t for t in tools if t["name"] == "edit_test_case_inputs"), None)
    assert edit_tool is not None
    assert "inputSchema" in edit_tool
    assert "updates" in edit_tool["inputSchema"]["properties"]

    # 2. tools/call calls edit_test_case_inputs cleanly
    out_dir = tmp_path / "suitest-output"
    call_msg = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "edit_test_case_inputs",
            "arguments": {"output_dir": str(out_dir)},
        },
    }
    call_resp = handle(call_msg)
    assert call_resp is not None
    assert call_resp["result"]["isError"] is False  # type: ignore[index]
    payload = json.loads(call_resp["result"]["content"][0]["text"])  # type: ignore[index]
    assert payload["success"] is True


def test_manage_test_case_dataset_tool(tmp_path: Path) -> None:
    from suitest_lifecycle.tools import manage_test_case_dataset

    out_dir = tmp_path / "suitest-output"

    # 1. Set dataset with columns and scenario rows
    schema = ["username", "password", "user_role"]
    rows = [
        {
            "name": "Admin User",
            "values": {"username": "admin", "password": "123", "user_role": "ADMIN"},
        },
        {
            "name": "Standard User",
            "values": {"username": "user", "password": "456", "user_role": "USER"},
        },
    ]
    res_set = manage_test_case_dataset(
        case_id="TC001",
        action="set",
        schema=schema,
        rows=rows,
        output_dir=str(out_dir),
    )
    assert res_set["success"] is True
    assert res_set["data"]["dataset_schema"] == schema  # type: ignore[index]

    # 2. Get dataset
    res_get = manage_test_case_dataset(
        case_id="TC001",
        action="get",
        output_dir=str(out_dir),
    )
    assert res_get["success"] is True
    assert len(res_get["data"]["dataset_rows"]) == 2  # type: ignore[index]

    # 3. Rename column from username -> user_email
    res_rename = manage_test_case_dataset(
        case_id="TC001",
        action="rename_column",
        old_column="username",
        new_column="user_email",
        output_dir=str(out_dir),
    )
    assert res_rename["success"] is True
    new_schema = res_rename["data"]["dataset_schema"]  # type: ignore[index]
    assert "user_email" in new_schema
    assert "username" not in new_schema

    # Verify migrated values in rows
    new_rows = res_rename["data"]["dataset_rows"]  # type: ignore[index]
    assert new_rows[0]["values"]["user_email"] == "admin"
    assert "username" not in new_rows[0]["values"]
    assert new_rows[1]["values"]["user_email"] == "user"


def test_mcp_server_advertises_new_tools() -> None:
    list_msg = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    resp = handle(list_msg)
    assert resp is not None
    tool_names = [t["name"] for t in resp["result"]["tools"]]  # type: ignore[index]
    assert "manage_test_case_dataset" in tool_names
    assert "get_workspace_variables" in tool_names
    assert "set_workspace_variable" in tool_names


def test_assertion_extracts_landmark_text() -> None:
    from suitest_lifecycle.blackbox.mcp import extract_steps_from_automation_code

    code = """
    _begin("assertion", "Dashboard heading 'Welcome Admin' is rendered")
    await expect(page.locator("h1")).to_have_text("Welcome Admin")
    """
    steps = extract_steps_from_automation_code(code)
    assert len(steps) == 1
    payload = json.loads(steps[0]["code"])
    assert payload["tool"] == "browser_wait_for"
    assert payload["arguments"].get("text") == "Welcome Admin"


def test_build_default_dataset_from_steps() -> None:
    from suitest_lifecycle.blackbox.mcp import build_default_dataset_from_steps

    raw_steps = [
        {
            "order": 1,
            "action": "Open login",
            "code": json.dumps({"tool": "browser_navigate", "arguments": {"url": "/login"}}),
        },
        {
            "order": 2,
            "action": "Fill Username",
            "code": json.dumps(
                {"tool": "browser_type", "arguments": {"target": "input#user", "text": "john_doe"}}
            ),
        },
        {
            "order": 3,
            "action": "Fill Password",
            "code": json.dumps(
                {"tool": "browser_type", "arguments": {"target": "input#pass", "text": "secret123"}}
            ),
        },
    ]

    param_steps, schema, rows = build_default_dataset_from_steps(raw_steps)
    assert schema == ["username", "password"]
    assert len(rows) == 1
    assert rows[0]["name"] == "Default Scenario"
    assert rows[0]["values"] == {"username": "john_doe", "password": "secret123"}

    # Steps are parameterized
    step_2_code = json.loads(param_steps[1]["code"])  # type: ignore[arg-type]
    assert step_2_code["arguments"]["text"] == "{{username}}"
    step_3_code = json.loads(param_steps[2]["code"])  # type: ignore[arg-type]
    assert step_3_code["arguments"]["text"] == "{{password}}"
