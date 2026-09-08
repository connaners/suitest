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
    from suitest_db.models.agent import AgentSession
    from suitest_shared.schemas.agent_chat import ConfirmedTool

# Publishes a ``{"event", "data"}`` envelope to the workspace WS channel.
WsPublish = Callable[[dict[str, object]], Awaitable[None]]


class AgentChatService:
    def __init__(self, session: AsyncSession, *, workspace_id: str, user_id: str | None) -> None:
        self._session = session
        self._workspace_id = workspace_id
        self._user_id = user_id

    @staticmethod
    def _strip_tool_fences(raw: str) -> str:
        """Remove <tool_call> wrappers and json code fences from a model turn."""
        if "<tool_call>" not in raw and "```json" not in raw:
            return raw
        return (
            raw.replace("<tool_call>", "")
            .replace("</tool_call>", "")
            .replace("```json", "")
            .replace("```", "")
            .strip()
        )

    @staticmethod
    def _last_tool_envelope(raw: str) -> dict[str, object]:
        """Return the LAST ``{"tool": ...}`` object in a model turn.

        A round may carry SEVERAL envelopes (e.g. case.get then
        case.set_steps); the last one is the newest request.
        """
        tool_obj: dict[str, object] = {}
        scan = raw
        while True:
            start = scan.find("{")
            if start == -1:
                break
            candidate = parse_json_object(scan[start:])
            if "tool" not in candidate:
                break
            tool_obj = candidate
            end_idx = scan.rfind("}")
            scan = scan[end_idx + 1 :] if end_idx != -1 else ""
        return tool_obj

    @staticmethod
    def _user_confirmed(tool_obj: dict[str, object], user_text: str) -> bool:
        """A mutation runs only on an explicit human decision (AUTONOMY.md).

        The model has no authority to confirm; the user's own message
        granting permission ("confirmed", "i approve", …) is, and typing
        one in the panel is explicit.
        """
        if bool(tool_obj.get("confirmed")):
            return True
        return any(
            marker in user_text for marker in ("confirmed", "i approve", "apply it", "yes, apply")
        )

    @staticmethod
    def _as_uuid(user_id: str | None) -> uuid.UUID | None:
        import uuid as _uuid

        try:
            return _uuid.UUID(user_id) if user_id else None
        except (ValueError, AttributeError):
            return None

    async def _resolve_session(
        self,
        request: ChatRequest,
        *,
        model: str,
        credential: ResolvedCredential,
        prompt_row_id: str,
        repo: AgentSessionRepo,
    ) -> AgentSession:
        """Reuse the panel's conversation when it passes a valid id, else create one.

        Reusing lets approve/reject follow-ups land in the same replayable thread.
        """
        if request.session_id:
            existing = await repo.get_by_id(request.session_id)
            if existing is not None and existing.workspace_id == self._workspace_id:
                return existing
        return await repo.create(
            AgentSessionCreate(
                workspace_id=self._workspace_id,
                kind=AgentSessionKind.CONVERSATION,
                model_id=model,
                provider=credential.provider,
                user_id=self._as_uuid(self._user_id),
                prompt_version_id=prompt_row_id,
                seed=request.seed,
                temperature=0.3,
            )
        )

    def _parse_tool_request(self, round_text: str) -> dict[str, object] | None:
        """Return the last tool envelope in a model turn, or ``None`` for plain prose."""
        tool_obj = self._last_tool_envelope(self._strip_tool_fences(round_text))
        tool = tool_obj.get("tool")
        if not (isinstance(tool, str) and tool.strip()):
            return None
        return tool_obj

    async def _apply_approved_tool(
        self,
        approved: ConfirmedTool,
        *,
        messages: list[ChatMessage],
        repo: AgentSessionRepo,
        ctx: TenantContext,
        case_service: TestCaseService,
        agent_session_id: str,
    ) -> None:
        """Run the user-approved envelope and append its result for the next round."""
        try:
            result = await execute_tool(
                approved.tool,
                approved.arguments,
                session=self._session,
                ctx=ctx,
                case_service=case_service,
                confirmed=True,
            )
            result_json = json.dumps(result, default=str)
            await repo.add_message(
                agent_session_id,
                role=MessageRole.TOOL,
                content=f"{approved.tool} executed (user-approved): {result_json}",
            )
            messages.append(
                ChatMessage(
                    role="user",
                    content=(
                        f"TOOL RESULT (user-approved execution of {approved.tool}): "
                        f"{result_json}\nReport the outcome to the user concisely."
                    ),
                )
            )
        except ToolInputError as exc:
            messages.append(
                ChatMessage(
                    role="user",
                    content=f"TOOL RESULT {approved.tool}: {json.dumps({'error': str(exc)})}",
                )
            )
        except ToolDeniedError:
            messages.append(
                ChatMessage(
                    role="user",
                    content=f"TOOL RESULT {approved.tool}: permission denied.",
                )
            )
        await self._session.commit()
        self._session.expire_all()

    async def _run_model_tool(
        self,
        tool: str,
        arguments: dict[str, object],
        *,
        ctx: TenantContext,
        case_service: TestCaseService,
        confirmed: bool,
    ) -> str | None:
        """Execute a model-requested tool. ``None`` means a mutation lacked a confirm."""
        try:
            result = await execute_tool(
                tool,
                arguments,
                session=self._session,
                ctx=ctx,
                case_service=case_service,
                confirmed=confirmed,
            )
            return json.dumps(result, default=str)
        except ToolInputError as exc:
            return json.dumps({"error": str(exc)})
        except ToolDeniedError:
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
        agent_session = await self._resolve_session(
            request, model=model, credential=credential, prompt_row_id=prompt_row.id, repo=repo
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

        # Deterministic approval path: the panel re-sends the exact envelope
        # the user approved. Execute it FIRST and feed the result to the
        # model — approval never depends on the model re-emitting the tool.
        approved = request.approved_tool
        if approved is not None:
            tool_data: dict[str, object] = {
                "tool": approved.tool,
                "arguments": approved.arguments,
                "confirmed": True,
                "agent_session_id": agent_session_id,
            }
            if publish is not None:
                await publish({"event": "agent.tool.call", "data": tool_data})
            yield ChatSseEvent(kind="tool", data=tool_data)
            await self._apply_approved_tool(
                approved,
                messages=messages,
                repo=repo,
                ctx=ctx,
                case_service=case_service,
                agent_session_id=agent_session_id,
            )

        user_text = last_user.content.lower() if last_user else ""
        max_tool_rounds = 4
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

            accumulated = round_accumulated
            tool_obj = self._parse_tool_request(round_accumulated)
            if tool_obj is None:
                break
            tool = str(tool_obj["tool"])
            arguments = tool_obj.get("arguments", {})
            arguments = arguments if isinstance(arguments, dict) else {}

            # The model has no field to mark confirmation; the USER's own
            # message granting permission ("confirmed", "i approve", …) is the
            # authority — AUTONOMY.md requires an explicit human decision, and
            # typing one in the panel is explicit.
            confirmed = self._user_confirmed(tool_obj, user_text)
            tool_data = {
                "tool": tool,
                "arguments": arguments,
                "confirmed": confirmed,
                "agent_session_id": agent_session_id,
            }
            if publish is not None:
                await publish({"event": "agent.tool.call", "data": tool_data})
            yield ChatSseEvent(kind="tool", data=tool_data)

            result_json = await self._run_model_tool(
                tool, arguments, ctx=ctx, case_service=case_service, confirmed=confirmed
            )
            if result_json is None:
                # Mutating tool without a user confirm: stop and surface it.
                break
            messages.append(ChatMessage(role="user", content=f"TOOL RESULT {tool}: {result_json}"))
            # Persist + drop stale identity-map state before the next round
            # reads rows the tool just wrote. Committing (not just expiring)
            # is required: expired ORM objects would lazy-load outside the
            # greenlet context when re-read later in this generator.
            await self._session.commit()
            self._session.expire_all()

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
