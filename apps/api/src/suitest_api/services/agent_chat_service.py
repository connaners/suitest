"""Agent conversation (chat) service (M3-12 / M3-13).

Streams the assistant reply token-by-token over SSE (``provider.stream_complete``)
and persists the turn as an ``AgentSession`` (kind CONVERSATION) + its user/agent
messages for replay. When the model emits a tool-request JSON instead of prose, a
``tool`` SSE frame is yielded AND mirrored on the WS gateway
(``agent.tool.call``) so the UI can surface a confirm (mutations always require an
explicit confirm — AUTONOMY.md §3 hard rail).

Tools (M3-12 extension): the panel model can call read-only tools
(``case.get``, ``cases.search``) immediately, and mutating tools
(``case.update_meta``, ``case.set_steps``) which execute through
:class:`~suitest_api.services.agent_tools.execute_tool` — the caller marks them
``confirmed`` so the UI confirm-card round-trip stays the authority.

CLOUD/LOCAL only; the router rejects ZERO / no-LLM with 409 before streaming.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from suitest_agent.graphs._util import parse_json_object
from suitest_agent.providers.base import ChatMessage, ModelCall
from suitest_core.llm_credentials import ResolvedCredential
from suitest_db.repositories.agent_sessions import AgentSessionCreate, AgentSessionRepo
from suitest_db.repositories.projects import ProjectRepo
from suitest_db.repositories.suites import SuiteRepo
from suitest_db.repositories.test_cases import TestCaseRepo
from suitest_shared.domain.enums import AgentSessionKind, MessageRole, Role
from suitest_shared.schemas.agent_chat import ChatRequest, ChatSseEvent

from suitest_api.deps.scope import TenantContext
from suitest_api.services.agent_tools import (
    TOOLS_PROMPT,
    ToolDeniedError,
    ToolInputError,
    execute_tool,
)
from suitest_api.services.llm_credentials import provider_for_credential
from suitest_api.services.prompt_resolver import resolve_and_pin
from suitest_api.services.test_case_service import TestCaseService

if TYPE_CHECKING:
    import uuid
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession

# Publishes a ``{"event", "data"}`` envelope to the workspace WS channel.
WsPublish = Callable[[dict[str, object]], Awaitable[None]]


class AgentChatService:
    def __init__(self, session: AsyncSession, *, workspace_id: str, user_id: str | None) -> None:
        self._session = session
        self._workspace_id = workspace_id
        self._user_id = user_id

    @staticmethod
    def _as_uuid(user_id: str | None) -> uuid.UUID | None:
        import uuid as _uuid

        try:
            return _uuid.UUID(user_id) if user_id else None
        except (ValueError, AttributeError):
            return None

    async def stream(
        self,
        request: ChatRequest,
        *,
        credential: ResolvedCredential,
        model: str,
        publish: WsPublish | None = None,
    ) -> AsyncIterator[ChatSseEvent]:
        """Stream the assistant reply; persist the session + messages."""
        # M5-3: honour an active per-workspace prompt fork; falls back to the
        # file default when none exists. ``resolve_and_pin`` also records the
        # reproducibility row, replacing the direct read_prompt + ensure pair.
        prompt_content, prompt_row = await resolve_and_pin(
            self._session, workspace_id=self._workspace_id, prompt_name="converse"
        )
        repo = AgentSessionRepo(self._session)
        agent_session = await repo.create(
            AgentSessionCreate(
                workspace_id=self._workspace_id,
                kind=AgentSessionKind.CONVERSATION,
                model_id=model,
                provider=credential.provider,
                user_id=self._as_uuid(self._user_id),
                prompt_version_id=prompt_row.id,
                seed=request.seed,
                temperature=0.3,
            )
        )

        # Persist the latest user turn (the rest is prior context already stored).
        last_user = next((m for m in reversed(request.messages) if m.role == "user"), None)
        if last_user is not None:
            await repo.add_message(
                agent_session.id, role=MessageRole.USER, content=last_user.content
            )

        yield ChatSseEvent(kind="progress", data={"agent_session_id": agent_session.id})
        # Capture once — expire_all() inside the tool loop invalidates ORM
        # attributes, and a later ``agent_session.id`` access would lazy-load
        # outside greenlet context and crash the stream.
        agent_session_id = agent_session.id

        # The tool catalogue rides on the system prompt so the model knows the
        # request envelope and which tools are read-only vs mutating.
        messages = [ChatMessage(role="system", content=prompt_content + TOOLS_PROMPT)]
        messages.extend(ChatMessage(role=m.role, content=m.content) for m in request.messages)

        ctx = TenantContext(
            workspace_id=self._workspace_id, user_id=self._user_id or "", role=Role.QA
        )
        case_service = TestCaseService(
            ctx,
            TestCaseRepo(self._session),
            SuiteRepo(self._session),
            ProjectRepo(self._session),
        )

        max_tool_rounds = 4
        accumulated = ""
        tokens_out = 0
        for _round in range(max_tool_rounds):
            call = ModelCall(model=model, messages=messages, seed=request.seed, temperature=0.3)
            provider = provider_for_credential(credential)
            round_accumulated = ""
            async for chunk in provider.stream_complete(call):
                if chunk.delta:
                    round_accumulated += chunk.delta
                    yield ChatSseEvent(kind="token", data={"delta": chunk.delta})
                if chunk.done:
                    tokens_out = chunk.tokens_out

            raw = round_accumulated
            # Providers wrap tool requests in <tool_call>…</tool_call> or
            # ```json fences — strip them so the parser sees the envelope.
            if "<tool_call>" in raw or "```json" in raw:
                raw = (
                    raw.replace("<tool_call>", "")
                    .replace("</tool_call>", "")
                    .replace("```json", "")
                    .replace("```", "")
                    .strip()
                )
            # A round may carry SEVERAL tool envelopes (e.g. case.get then
            # case.set_steps). The LAST one is the newest request.
            tool_obj: dict[str, object] = {}
            scan = raw
            while True:
                start = scan.find("{")
                if start == -1:
                    break
                candidate = parse_json_object(scan[start:])
                if "tool" in candidate:
                    tool_obj = candidate
                    consumed = scan[start:]
                    end_idx = consumed.rfind("}")
                    scan = consumed[end_idx + 1 :] if end_idx != -1 else ""
                else:
                    break

            tool = tool_obj.get("tool")
            if not (isinstance(tool, str) and tool.strip()):
                accumulated = round_accumulated
                break

            arguments = tool_obj.get("arguments", {})
            arguments = arguments if isinstance(arguments, dict) else {}
            # The model has no field to mark confirmation; the USER's own
            # message granting permission ("confirmed", "i approve", …) is the
            # authority — AUTONOMY.md requires an explicit human decision, and
            # typing one in the panel is explicit.
            user_text = last_user.content.lower() if last_user else ""
            user_confirmed = any(
                marker in user_text
                for marker in (
                    "confirmed",
                    "i approve",
                    "approve the change",
                    "apply it",
                    "yes, apply",
                )
            )
            confirmed = bool(tool_obj.get("confirmed")) or user_confirmed
            tool_data: dict[str, object] = {
                "tool": tool,
                "arguments": arguments,
                "confirmed": confirmed,
                "agent_session_id": agent_session_id,
            }
            if publish is not None:
                await publish({"event": "agent.tool.call", "data": tool_data})
            yield ChatSseEvent(kind="tool", data=tool_data)

            try:
                result = await execute_tool(
                    tool,
                    arguments,
                    session=self._session,
                    ctx=ctx,
                    case_service=case_service,
                    confirmed=confirmed,
                )
                result_json = json.dumps(result, default=str)
            except ToolInputError as exc:
                result_json = json.dumps({"error": str(exc)})
            except ToolDeniedError:
                # Mutating tool without a user confirm: stop and surface it.
                accumulated = round_accumulated
                break
            messages.append(ChatMessage(role="user", content=f"TOOL RESULT {tool}: {result_json}"))
            # Persist + drop stale identity-map state before the next round
            # reads rows the tool just wrote. Committing (not just expiring)
            # is required: expired ORM objects would lazy-load outside the
            # greenlet context when re-read later in this generator.
            await self._session.commit()
            self._session.expire_all()
        else:
            accumulated = round_accumulated

        await repo.add_message(agent_session_id, role=MessageRole.AGENT, content=accumulated)
        await repo.complete(agent_session_id, tokens_out=tokens_out)
        await self._session.commit()

        yield ChatSseEvent(
            kind="done",
            data={
                "agent_session_id": agent_session_id,
                "content": accumulated,
                "tokens_out": tokens_out,
            },
        )
