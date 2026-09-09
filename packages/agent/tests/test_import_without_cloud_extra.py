"""Lock-in test: agent modules must import at ZERO tier without litellm/langgraph.

All four graph modules use langgraph only inside function bodies (lazy) or under
TYPE_CHECKING (annotation-only), and litellm_router uses litellm only inside
methods — so module-level import of any of these must succeed even when the
'cloud' optional-dependencies extra is absent.
"""

from __future__ import annotations

import importlib
import sys

import pytest
from suitest_agent.providers.base import ChatMessage, ModelCall, ProviderError
from suitest_agent.providers.litellm_router import LiteLLMProvider


def test_agent_package_imports_without_cloud_deps() -> None:
    # These modules must import at ZERO tier without litellm/langgraph installed.
    for mod in (
        "suitest_agent.providers.base",
        "suitest_agent.providers.litellm_router",
        "suitest_agent.graphs.execution",
        "suitest_agent.graphs.generation",
        "suitest_agent.graphs.conversation",
        "suitest_agent.graphs.diagnosis",
    ):
        importlib.import_module(mod)


@pytest.mark.asyncio
async def test_completion_without_litellm_is_a_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # None in sys.modules makes `import litellm` raise ImportError — the shape a
    # bundle that skipped the 'cloud' extra has. It must reach the caller as a
    # ProviderError (reported as a failed test), never as an unhandled crash.
    monkeypatch.setitem(sys.modules, "litellm", None)
    provider = LiteLLMProvider(provider="custom", api_key="k", base_url="https://gw.example")
    call = ModelCall(model="mimo", messages=[ChatMessage(role="user", content="ping")])

    with pytest.raises(ProviderError) as excinfo:
        await provider.complete(call)
    assert excinfo.value.code == "LLM_DEPS_MISSING"
