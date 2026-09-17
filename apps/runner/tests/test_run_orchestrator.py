"""Tests for the M1c run orchestrator.

The orchestrator is hard to unit test against a real Postgres in CI, so the
fixtures in ``conftest.py`` stub the three repos the orchestrator instantiates
(``RunRepo`` / ``RunStepRepo`` / ``WorkspaceCapabilityRepo``), the
:class:`McpInvoker`, the :class:`McpRegistry`, and the Redis publisher.

The four tests below exercise:

* full event sequence with one failing step,
* per-step DB inserts are recorded in order,
* all-PASS aggregation drives ``RunStatus.PASS``,
* missing run returns a structured error instead of raising.
"""

from __future__ import annotations

import json

import pytest
from suitest_runner.jobs.run_test_case import run_test_case

pytestmark = pytest.mark.asyncio


async def test_publishes_full_event_sequence_with_one_fail(
    stub_ctx_with_run: tuple[dict[str, object], object],
) -> None:
    """3 steps (2 PASS + 1 FAIL) → run.started + 3*(start/completed) + run.completed."""
    ctx, redis_stub = stub_ctx_with_run
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "FAIL"
    published = redis_stub.published["run:run-1"]  # type: ignore[attr-defined]
    events = [json.loads(m)["event"] for m in published]
    assert events[0] == "run.started"
    assert events[-1] == "run.completed"
    assert events.count("run.step.started") == 3
    assert events.count("run.step.completed") == 3


async def test_persists_three_run_steps(
    stub_ctx_with_run: tuple[dict[str, object], object],
) -> None:
    """One ``RunStepRepo.create_step`` call per step in the selection."""
    ctx, _ = stub_ctx_with_run
    await run_test_case(ctx, "run-1")
    inserted = ctx["_inserted_steps"]
    assert isinstance(inserted, list)
    assert len(inserted) == 3


async def test_all_pass_marks_run_pass(
    stub_ctx_all_pass: tuple[dict[str, object], object],
) -> None:
    """No failing steps → run reports PASS and the passed counter matches total."""
    ctx, _ = stub_ctx_all_pass
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"
    assert out["passed"] == 3
    assert out["failed"] == 0
    assert out["errored"] == 0


async def test_missing_run_returns_error(stub_ctx_empty: dict[str, object]) -> None:
    """Unknown run → structured ``RUN_NOT_FOUND`` error, no events published."""
    out = await run_test_case(stub_ctx_empty, "missing")
    assert out.get("error") == "RUN_NOT_FOUND"


async def test_auto_self_heal_retries_once_and_counts_final_pass(
    stub_ctx_auto_self_heal: tuple[dict[str, object], object],
) -> None:
    ctx, redis_stub = stub_ctx_auto_self_heal
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"
    assert out["passed"] == 1
    inserted = ctx["_inserted_steps"]
    assert isinstance(inserted, list)
    assert len(inserted) == 1
    assert inserted[0]["state_snapshot"] == {
        "failureKind": "selector_changed",
        "action": "step s0",
        "description": "step s0",
        "selfHeal": {
            "failureKind": "selector_changed",
            "oldSelector": "#old",
            "newSelector": "#new",
            "retryCount": 1,
            "originalError": "MCP_TOOL_FAILED: Timeout waiting for locator('#submit')",
            "retryOutcome": "PASS",
            "persisted": True,
        },
    }
    published = redis_stub.published["run:run-1"]  # type: ignore[attr-defined]
    completed = next(
        json.loads(message)["data"]
        for message in published
        if json.loads(message)["event"] == "run.step.completed"
    )
    assert completed["selfHeal"]["retryOutcome"] == "PASS"


async def test_selector_failure_is_classified_without_auto_repair(
    stub_ctx_selector_fail: tuple[dict[str, object], object],
) -> None:
    ctx, _ = stub_ctx_selector_fail
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "FAIL"
    inserted = ctx["_inserted_steps"]
    assert isinstance(inserted, list)
    assert inserted[0]["state_snapshot"] == {
        "failureKind": "selector_changed",
        "action": "step s0",
        "description": "step s0",
    }


async def test_zero_steps_marks_run_error(stub_ctx_no_steps: dict[str, object]) -> None:
    """An empty selection must not report a green run (issue #109)."""
    out = await run_test_case(stub_ctx_no_steps, "run-1")
    assert out["status"] == "ERROR"
    assert out["total"] == 0


async def test_aborts_subsequent_steps_in_failed_case_and_advances_to_next_case(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When a case step fails, subsequent steps in that case are skipped and the next case runs."""
    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_invoker,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    c1_s0 = _make_step("c1_s0", {"tool": "t", "arguments": {}})
    c1_s1 = _make_step("c1_s1", {"tool": "t", "arguments": {}})
    c1_s2 = _make_step("c1_s2", {"tool": "t", "arguments": {}})
    c2_s0 = _make_step("c2_s0", {"tool": "t", "arguments": {}})
    c2_s1 = _make_step("c2_s1", {"tool": "t", "arguments": {}})

    selection = [
        ("case-1", 0, c1_s0),
        ("case-1", 1, c1_s1),
        ("case-1", 2, c1_s2),
        ("case-2", 3, c2_s0),
        ("case-2", 4, c2_s1),
    ]

    invoker = _make_invoker(["PASS", "FAIL", "PASS", "PASS"])
    run = _make_run()
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": invoker,
        "registry": _make_registry_instance(),
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "FAIL"
    assert out["passed"] == 3  # c1_s0, c2_s0, c2_s1
    assert out["failed"] == 1  # c1_s1
    assert len(inserted_steps) == 4
    case_ids = [s["case_id"] for s in inserted_steps]
    assert case_ids == ["case-1", "case-1", "case-2", "case-2"]


async def test_playwright_config_auto_screenshot_and_highlighting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """playwright_config with screenshot='on' and highlight_steps=True triggers auto capture."""
    from suitest_mcp.invoker import McpInvoker
    from suitest_mcp.models import McpArtifact, McpToolResult

    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    step = _make_step("s0", {"tool": "browser_click", "arguments": {"selector": "#btn-submit"}})
    step.target_kind = "FE_WEB"
    step.mcp_provider = "playwright-mcp"
    selection = [("case-1", 0, step)]

    invocations: list[tuple[str, dict[str, object]]] = []

    class _SpyInvoker(McpInvoker):
        def __init__(self) -> None:
            pass

        async def invoke(
            self,
            *,
            explicit_provider: str | None = None,
            tool: str,
            arguments: dict[str, object],
            ctx: object,
        ) -> McpToolResult:
            invocations.append((tool, arguments))
            if tool == "browser_take_screenshot":
                return McpToolResult(
                    ok=True,
                    artifacts=[
                        McpArtifact(
                            kind="SCREENSHOT",
                            filename="auto-shot.png",
                            content_type="image/png",
                            bytes=b"fake-png-bytes",
                        )
                    ],
                    duration_ms=50,
                )
            return McpToolResult(ok=True, stdout="{}", duration_ms=10)

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "screenshot": "on",
            "highlight_steps": True,
            "headless": True,
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": _SpyInvoker(),
        "registry": _make_registry_instance(),
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"

    tools_called = [tool for tool, _ in invocations]
    # Highlight called before step execution
    assert "browser_evaluate" in tools_called
    # Step itself called
    assert "browser_click" in tools_called
    # Auto-screenshot captured after step
    assert "browser_take_screenshot" in tools_called


async def test_playwright_config_headed_mode_registers_headed_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """playwright_config with headless=False registers headed provider config with isolated pool id."""
    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_invoker,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    step = _make_step("s0", {"tool": "browser_click", "arguments": {"selector": "#btn"}})
    step.target_kind = "FE_WEB"
    step.mcp_provider = "playwright-mcp"
    selection = [("case-1", 0, step)]

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "headless": False,
            "screenshot": "off",
            "highlight_steps": False,
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    registry = _make_registry_instance("ws-1")
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": _make_invoker(["PASS"]),
        "registry": registry,
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"

    provider = registry._by_workspace["ws-1"]["playwright-mcp"]
    assert provider.id == "builtin:playwright-mcp:ws-1:headed"
    assert "--headless" not in provider.command
    assert provider.config_json["headless"] is False


async def test_playwright_config_bypasses_highlight_when_headless_and_no_media(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When headless=True, screenshot='off', and video='off', highlight_steps is bypassed."""
    from suitest_mcp.invoker import McpInvoker
    from suitest_mcp.models import McpToolResult

    from .conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    step = _make_step("s0", {"tool": "browser_click", "arguments": {"selector": "#btn"}})
    step.target_kind = "FE_WEB"
    step.mcp_provider = "playwright-mcp"
    selection = [("case-1", 0, step)]

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "headless": True,
            "screenshot": "off",
            "video": "off",
            "highlight_steps": True,
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    registry = _make_registry_instance("ws-1")
    tools_called: list[str] = []

    class _CaptureInvoker(McpInvoker):
        def __init__(self) -> None:
            pass

        async def invoke(
            self,
            *,
            explicit_provider: str | None = None,
            tool: str,
            arguments: dict[str, object],
            ctx: object,
        ) -> McpToolResult:
            tools_called.append(tool)
            return McpToolResult(ok=True, stdout="{}", duration_ms=10)

    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": _CaptureInvoker(),
        "registry": registry,
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"

    # Because headless is True and screenshot & video are off, highlight evaluate calls are bypassed
    assert "browser_evaluate" not in tools_called


async def test_build_highlight_script_strategies() -> None:
    """_build_highlight_script correctly handles CSS, XPath, text, id, name, data-testid, and role selectors."""
    from suitest_runner.jobs.run_test_case import _build_highlight_script

    css_js = _build_highlight_script("#submit-btn")
    assert '"#submit-btn"' in css_js
    assert "data-suitest-highlight" in css_js
    assert "document.querySelector" in css_js

    xpath_js = _build_highlight_script("//button[@id='save']")
    assert "document.evaluate" in xpath_js
    assert "\"//button[@id='save']\"" in xpath_js

    text_js = _build_highlight_script("text='Sign In'")
    assert "createTreeWalker" in text_js
    assert "Sign In" in text_js
    assert "needle" in text_js

    id_js = _build_highlight_script("id=username")
    assert "document.getElementById" in id_js
    assert "username" in id_js

    name_js = _build_highlight_script("name=password")
    assert "sel.startsWith('name=')" in name_js
    assert '"name=password"' in name_js

    testid_js = _build_highlight_script("data-testid=login-btn")
    assert "sel.startsWith('data-testid=')" in testid_js
    assert '"data-testid=login-btn"' in testid_js

    role_js = _build_highlight_script("role=button")
    assert "sel.startsWith('role=')" in role_js
    assert '"role=button"' in role_js


async def test_clean_session_between_cases_recycles_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """clean_session_between_cases triggers provider session recycle between distinct cases."""
    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_invoker,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    recycled_providers: list[str] = []

    class _SpyPool:
        async def recycle_provider(self, provider_id: str) -> None:
            recycled_providers.append(provider_id)

    step1 = _make_step("s1", {"tool": "browser_click", "arguments": {"selector": "#btn1"}})
    step1.target_kind = "FE_WEB"
    step1.mcp_provider = "playwright-mcp"

    step2 = _make_step("s2", {"tool": "browser_click", "arguments": {"selector": "#btn2"}})
    step2.target_kind = "FE_WEB"
    step2.mcp_provider = "playwright-mcp"

    selection = [("case-1", 0, step1), ("case-2", 1, step2)]

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "headless": False,
            "clean_session_between_cases": True,
            "screenshot": "off",
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    registry = _make_registry_instance("ws-1")
    invoker = _make_invoker(["PASS", "PASS"])
    invoker.pool = _SpyPool()  # type: ignore[assignment]
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": invoker,
        "registry": registry,
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"

    # Must have recycled between case-1 and case-2, plus final cleanup
    assert len(recycled_providers) >= 2
    assert "builtin:playwright-mcp:ws-1:headed" in recycled_providers


async def test_playwright_video_recording_lifecycle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """video='on' triggers browser_start_video and browser_stop_video per case."""
    from suitest_mcp.models import McpToolResult

    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_invoker,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    invoked_tools: list[str] = []

    step1 = _make_step("s1", {"tool": "browser_click", "arguments": {"selector": "#btn1"}})
    step1.target_kind = "FE_WEB"
    step1.mcp_provider = "builtin:playwright-mcp:ws-1"

    step2 = _make_step("s2", {"tool": "browser_click", "arguments": {"selector": "#btn2"}})
    step2.target_kind = "FE_WEB"
    step2.mcp_provider = "builtin:playwright-mcp:ws-1"

    selection = [("case-1", 0, step1), ("case-2", 1, step2)]

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "headless": True,
            "video": "on",
            "screenshot": "off",
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    registry = _make_registry_instance("ws-1")
    invoker = _make_invoker(["PASS", "PASS"])
    orig_invoke = invoker.invoke

    async def _tracking_invoke(*, tool: str, **kwargs: object) -> McpToolResult:
        invoked_tools.append(tool)
        if tool == "browser_stop_video":
            return McpToolResult(
                ok=True,
                output={},
                stdout="### Result\n- [Video](.playwright-mcp/video-mock.webm)",
                duration_ms=5,
            )
        return await orig_invoke(tool=tool, **kwargs)

    invoker.invoke = _tracking_invoke  # type: ignore[assignment]
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": invoker,
        "registry": registry,
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"

    # Must start and stop video for case-1 and case-2
    assert invoked_tools.count("browser_start_video") == 2
    assert invoked_tools.count("browser_stop_video") == 2


async def test_playwright_config_highlight_steps_camel_case_and_failure_screenshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """highlightSteps (camelCase) and failure screenshot work with target_pw_provider."""
    from suitest_mcp.errors import McpToolFailed
    from suitest_mcp.invoker import McpInvoker
    from suitest_mcp.models import McpArtifact, McpToolResult

    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    step = _make_step("s0", {"tool": "browser_click", "arguments": {"selector": "#missing"}})
    step.target_kind = "FE_WEB"
    step.mcp_provider = "playwright-mcp"
    selection = [("case-1", 0, step)]

    invocations: list[tuple[str | None, str, dict[str, object]]] = []

    class _SpyInvoker(McpInvoker):
        def __init__(self) -> None:
            pass

        async def invoke(
            self,
            *,
            explicit_provider: str | None = None,
            tool: str,
            arguments: dict[str, object],
            ctx: object,
        ) -> McpToolResult:
            invocations.append((explicit_provider, tool, arguments))
            if tool == "browser_click":
                raise McpToolFailed("Timeout waiting for locator('#missing')")
            if tool == "browser_take_screenshot":
                return McpToolResult(
                    ok=True,
                    artifacts=[
                        McpArtifact(
                            kind="SCREENSHOT",
                            filename="fail-shot.png",
                            content_type="image/png",
                            bytes=b"fake-fail-bytes",
                        )
                    ],
                    duration_ms=50,
                )
            return McpToolResult(ok=True, stdout="{}", duration_ms=10)

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "screenshot": "only-on-failure",
            "highlightSteps": True,  # camelCase from frontend
            "headless": True,
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": _SpyInvoker(),
        "registry": _make_registry_instance(),
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "FAIL"

    tools = [(prov, tool) for prov, tool, _ in invocations]
    # Highlight invoked on target_pw_provider
    target_prov = "builtin:playwright-mcp:ws-1"
    assert (target_prov, "browser_evaluate") in tools
    # Step was called
    assert ("playwright-mcp", "browser_click") in tools
    # Failure screenshot was taken using target_pw_provider
    assert (target_prov, "browser_take_screenshot") in tools


async def test_build_highlight_script_includes_scroll_and_dual_layer() -> None:
    from suitest_runner.jobs.run_test_case import _build_highlight_script

    script = _build_highlight_script("#submit-btn")
    assert "scrollIntoView" in script
    assert "data-suitest-highlight" in script
    assert "2563eb" in script


async def test_highlight_steps_executes_action_captures_after_shot_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Full lifecycle: highlight before action, execute action, screenshot after action, clear highlight."""
    from suitest_mcp.invoker import McpInvoker
    from suitest_mcp.models import McpArtifact, McpToolResult

    from tests.conftest import (
        _install_repo_stubs,
        _make_capability,
        _make_project,
        _make_registry_instance,
        _make_run,
        _make_step,
        _RecordingRedis,
        _session_factory,
    )

    step = _make_step("s0", {"tool": "browser_click", "arguments": {"selector": "#submit-btn"}})
    step.target_kind = "FE_WEB"
    step.mcp_provider = "playwright-mcp"
    selection = [("case-1", 0, step)]

    invocations: list[tuple[str | None, str, dict[str, object]]] = []

    class _SpyInvoker(McpInvoker):
        def __init__(self) -> None:
            pass

        async def invoke(
            self,
            *,
            explicit_provider: str | None = None,
            tool: str,
            arguments: dict[str, object],
            ctx: object,
        ) -> McpToolResult:
            invocations.append((explicit_provider, tool, arguments))
            if tool == "browser_take_screenshot":
                return McpToolResult(
                    ok=True,
                    artifacts=[
                        McpArtifact(
                            kind="SCREENSHOT",
                            filename="step-shot.png",
                            content_type="image/png",
                            bytes=b"fake-bytes",
                        )
                    ],
                    duration_ms=40,
                )
            return McpToolResult(ok=True, stdout="{}", duration_ms=10)

    run = _make_run()
    run.metadata_json = {
        "playwright_config": {
            "screenshot": "on",
            "highlightSteps": True,
            "headless": True,
        }
    }
    cap = _make_capability()
    inserted_steps: list[dict[str, object]] = []
    _install_repo_stubs(
        monkeypatch,
        run=run,
        selection=selection,
        capability=cap,
        inserted_steps=inserted_steps,
    )
    redis = _RecordingRedis()
    ctx: dict[str, object] = {
        "session_factory": _session_factory(_make_project()),
        "redis": redis,
        "invoker": _SpyInvoker(),
        "registry": _make_registry_instance(),
    }
    out = await run_test_case(ctx, "run-1")
    assert out["status"] == "PASS"

    tools = [tool for _, tool, _ in invocations]
    # Sequence:
    # 1. browser_evaluate (pre-clear ghost highlight)
    # 2. browser_evaluate (highlight target element)
    # 3. browser_click (step action)
    # 4. browser_evaluate (re-apply highlight after action)
    # 5. browser_take_screenshot (after shot with highlight)
    # 6. browser_evaluate (clear highlight in finally)
    assert tools == [
        "browser_evaluate",
        "browser_evaluate",
        "browser_click",
        "browser_evaluate",
        "browser_take_screenshot",
        "browser_evaluate",
    ]
    # Check that pre-clear removed any prior highlight
    pre_clear_script = str(invocations[0][2].get("script", ""))
    assert "removeAttribute('data-suitest-highlight')" in pre_clear_script

    # Check that highlight script set highlight and scrolled
    highlight_script = str(invocations[1][2].get("script", ""))
    assert "data-suitest-highlight" in highlight_script
    assert "scrollIntoView" in highlight_script

    # Check that post-action rehighlight set highlight
    rehighlight_script = str(invocations[3][2].get("script", ""))
    assert "data-suitest-highlight" in rehighlight_script

    # Check that final evaluate cleared it
    final_clear_script = str(invocations[5][2].get("script", ""))
    assert "removeAttribute('data-suitest-highlight')" in final_clear_script
