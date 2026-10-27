import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from suitest_mcp.models import McpToolResult
from suitest_runner.executors.step_executor import (
    _preflight_tcp_probe,
    execute_step,
)
from suitest_shared.domain.enums import StepOutcome


def _step(code_str: str, action: str = "Test Step"):
    mock = MagicMock()
    mock.id = "step-test-1"
    mock.order = 1
    mock.code = code_str
    mock.action = action
    mock.mcp_provider = "playwright-mcp"
    mock.target_kind = "FE_WEB"
    return mock


@pytest.mark.asyncio
async def test_preflight_tcp_probe_success():
    # Start a temporary local TCP server
    server = await asyncio.start_server(lambda r, w: w.close(), "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]

    async with server:
        reachable, err = await _preflight_tcp_probe("127.0.0.1", port, timeout_sec=1.0)
        assert reachable is True
        assert err is None


@pytest.mark.asyncio
async def test_preflight_tcp_probe_unreachable_closed_port():
    # Pick a port unlikely to be open
    reachable, err = await _preflight_tcp_probe("127.0.0.1", 59999, timeout_sec=0.5)
    assert reachable is False
    assert err is not None


@pytest.mark.asyncio
async def test_execute_step_navigate_fast_fails_on_unreachable_host():
    inv = MagicMock()
    inv.invoke = AsyncMock(
        return_value=McpToolResult(ok=True, output={}, stdout="", duration_ms=10)
    )

    # Test navigate step targeting an unreachable domain
    step = _step(
        json.dumps(
            {
                "tool": "browser_navigate",
                "arguments": {"url": "http://127.0.0.1:59999/login", "_force_preflight": True},
            }
        ),
        action="Open login page",
    )

    result = await execute_step(
        invoker=inv,
        test_step=step,
        run_id="run-1",
        workspace_id="ws-1",
        actor_user_id=None,
        routing_overrides=None,
    )

    assert result.outcome == StepOutcome.ERROR
    assert "TARGET_UNREACHABLE" in (result.error_message or "")
    assert "127.0.0.1:59999" in (result.error_message or "")
    # Invoker must never have been called because pre-flight aborted before browser launch
    inv.invoke.assert_not_called()


@pytest.mark.asyncio
async def test_execute_step_navigate_skip_preflight_flag():
    inv = MagicMock()
    inv.invoke = AsyncMock(
        return_value=McpToolResult(ok=True, output={}, stdout="navigated", duration_ms=10)
    )

    step = _step(
        json.dumps(
            {
                "tool": "browser_navigate",
                "arguments": {"url": "http://127.0.0.1:59999/login", "_skip_preflight": True},
            }
        ),
        action="Open login page with skip",
    )

    result = await execute_step(
        invoker=inv,
        test_step=step,
        run_id="run-1",
        workspace_id="ws-1",
        actor_user_id=None,
        routing_overrides=None,
    )

    assert result.outcome == StepOutcome.PASS
    inv.invoke.assert_called_once()
