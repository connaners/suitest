"""Tests for agent sessions / messages / tool calls (Task 2h)."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from suitest_db.ids import new_id
from suitest_db.models.agent import AgentMessage, AgentSession, AgentToolCall
from suitest_db.models.workspace import Workspace
from suitest_db.repositories.agent_sessions import AgentSessionRepo
from suitest_shared.domain.enums import AgentSessionKind, MessageRole


async def _workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(slug=f"ws-{new_id()}", name="WS")
    session.add(ws)
    await session.flush()
    return ws


async def _agent_session(session: AsyncSession, ws: Workspace) -> AgentSession:
    a = AgentSession(
        workspace_id=ws.id,
        kind=AgentSessionKind.GENERATION,
        model_id="claude-3",
        provider="anthropic",
    )
    session.add(a)
    await session.flush()
    return a


@pytest.mark.asyncio
async def test_agent_session_defaults(session: AsyncSession) -> None:
    ws = await _workspace(session)
    a = await _agent_session(session, ws)
    fetched = await session.scalar(select(AgentSession).where(AgentSession.id == a.id))
    assert fetched is not None
    assert fetched.status == "active"
    assert fetched.tokens_in == 0
    assert fetched.tokens_out == 0
    assert fetched.prompt_version_id is None


@pytest.mark.asyncio
async def test_agent_tool_call_input_required(session: AsyncSession) -> None:
    ws = await _workspace(session)
    a = await _agent_session(session, ws)
    msg = AgentMessage(session_id=a.id, role=MessageRole.AGENT, content="hi")
    session.add(msg)
    await session.flush()
    # input omitted (NOT NULL).
    tc = AgentToolCall(message_id=msg.id, tool_name="navigate")
    session.add(tc)
    with pytest.raises(IntegrityError):
        await session.flush()


@pytest.mark.asyncio
async def test_agent_message_cascade_on_session_delete(session: AsyncSession) -> None:
    ws = await _workspace(session)
    a = await _agent_session(session, ws)
    msg = AgentMessage(session_id=a.id, role=MessageRole.USER, content="hi")
    session.add(msg)
    await session.flush()
    mid = msg.id

    await session.delete(a)
    await session.flush()
    session.expunge_all()
    assert await session.get(AgentMessage, mid) is None


@pytest.mark.asyncio
async def test_agent_tool_call_cascade_on_message_delete(session: AsyncSession) -> None:
    ws = await _workspace(session)
    a = await _agent_session(session, ws)
    msg = AgentMessage(session_id=a.id, role=MessageRole.AGENT, content="hi")
    session.add(msg)
    await session.flush()
    tc = AgentToolCall(message_id=msg.id, tool_name="navigate", input={"url": "/"})
    session.add(tc)
    await session.flush()
    tcid = tc.id

    await session.delete(msg)
    await session.flush()
    session.expunge_all()
    assert await session.get(AgentToolCall, tcid) is None


async def _pending_call(session: AsyncSession, sess: AgentSession) -> AgentToolCall:
    msg = AgentMessage(session_id=sess.id, role=MessageRole.AGENT, content="proposal")
    session.add(msg)
    await session.flush()
    tc = AgentToolCall(
        message_id=msg.id,
        tool_name="case.set_steps",
        input={"case_id": "TC-1"},
        status="pending",
    )
    session.add(tc)
    await session.flush()
    return tc


@pytest.mark.asyncio
async def test_get_pending_tool_call_is_session_scoped(session: AsyncSession) -> None:
    ws = await _workspace(session)
    mine = await _agent_session(session, ws)
    other = await _agent_session(session, ws)
    call = await _pending_call(session, mine)
    repo = AgentSessionRepo(session)

    # Wrong session id must not resolve the call — no cross-conversation approval.
    assert await repo.get_pending_tool_call(call.id, session_id=other.id) is None
    found = await repo.get_pending_tool_call(call.id, session_id=mine.id)
    assert found is not None and found.id == call.id


@pytest.mark.asyncio
async def test_get_pending_tool_call_is_single_use(session: AsyncSession) -> None:
    ws = await _workspace(session)
    sess = await _agent_session(session, ws)
    call = await _pending_call(session, sess)
    repo = AgentSessionRepo(session)

    await repo.settle_tool_call(call.id, status="completed", output={"ok": True})
    # Once settled it is no longer 'pending', so a replayed approval finds nothing.
    assert await repo.get_pending_tool_call(call.id, session_id=sess.id) is None
