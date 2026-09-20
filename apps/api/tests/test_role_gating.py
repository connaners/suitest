"""Unit tests for role-based authorization dependency (require_role).

Verifies that OWNER, ADMIN, QA, and VIEWER permissions are strictly enforced
across write boundaries and member management boundaries.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from suitest_api.deps.role import require_role
from suitest_api.deps.scope import TenantContext
from suitest_shared.domain.enums import Role


def _make_ctx(role: Role) -> TenantContext:
    return TenantContext(
        user_id="usr_test_123",
        workspace_id="ws_test_456",
        role=role,
    )


def test_require_role_qa_or_higher_permits_owner_admin_qa() -> None:
    checker = require_role({Role.QA, Role.ADMIN, Role.OWNER})

    for permitted_role in (Role.OWNER, Role.ADMIN, Role.QA):
        ctx = _make_ctx(permitted_role)
        result = checker(ctx)
        assert result is ctx
        assert result.role == permitted_role


def test_require_role_qa_or_higher_forbids_viewer() -> None:
    checker = require_role(
        {Role.QA, Role.ADMIN, Role.OWNER},
        message="Role QA or higher required to mutate resources",
    )
    ctx = _make_ctx(Role.VIEWER)

    with pytest.raises(HTTPException) as exc_info:
        checker(ctx)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Role QA or higher required to mutate resources"


def test_require_role_admin_or_higher() -> None:
    checker = require_role({Role.ADMIN, Role.OWNER})

    assert checker(_make_ctx(Role.OWNER)).role == Role.OWNER
    assert checker(_make_ctx(Role.ADMIN)).role == Role.ADMIN

    for forbidden in (Role.QA, Role.VIEWER):
        with pytest.raises(HTTPException) as exc_info:
            checker(_make_ctx(forbidden))
        assert exc_info.value.status_code == 403


def test_require_role_owner_only() -> None:
    checker = require_role({Role.OWNER})

    assert checker(_make_ctx(Role.OWNER)).role == Role.OWNER

    for forbidden in (Role.ADMIN, Role.QA, Role.VIEWER):
        with pytest.raises(HTTPException) as exc_info:
            checker(_make_ctx(forbidden))
        assert exc_info.value.status_code == 403


def test_require_role_default_message() -> None:
    checker = require_role({Role.ADMIN, Role.OWNER})
    ctx = _make_ctx(Role.VIEWER)

    with pytest.raises(HTTPException) as exc_info:
        checker(ctx)

    assert exc_info.value.status_code == 403
    assert "role 'VIEWER' is not permitted" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_tenant_context_raises_revoked_structure_when_no_membership() -> None:
    import uuid
    from unittest.mock import AsyncMock, MagicMock

    from suitest_api.deps.scope import get_tenant_context

    req = MagicMock()
    req.path_params = {"workspaceId": "ws-123"}
    req.query_params = {}
    user = MagicMock()
    user.id = uuid.uuid4()
    session = AsyncMock()
    session.scalar.return_value = None  # No membership

    with pytest.raises(HTTPException) as exc_info:
        await get_tenant_context(
            request=req,
            user=user,
            session=session,
            x_workspace_id=None,
        )

    assert exc_info.value.status_code == 403
    assert isinstance(exc_info.value.detail, dict)
    assert exc_info.value.detail["code"] == "WORKSPACE_MEMBERSHIP_REVOKED"
    assert "user is not a member" in exc_info.value.detail["message"]
