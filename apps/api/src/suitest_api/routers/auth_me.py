"""``GET /auth/me`` — current user + memberships (docs/API.md §3.1).

User-scoped (NOT workspace-scoped): it answers "who am I and which workspaces can
I see", so it depends only on ``current_active_user`` + a DB session, never on
``require_workspace_membership``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from suitest_db.audit import write_audit
from suitest_db.models.user import User
from suitest_db.repositories.workspaces import WorkspaceRepo

from suitest_api.auth.db import get_async_session
from suitest_api.auth.manager import current_active_user
from suitest_api.auth.schemas import NameUpdateRequest
from suitest_api.schemas.workspace import (
    MembershipPublic,
    MeResponse,
    WorkspacePublic,
)

router = APIRouter(prefix="/api/v1", tags=["auth"])


@router.get("/auth/me", response_model=MeResponse)
async def get_me(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> MeResponse:
    """Return the authenticated user plus every workspace membership they hold."""
    memberships = await WorkspaceRepo(session).list_memberships_for_user(user.id)
    return MeResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        must_change_password=user.must_change_password,
        is_superuser=user.is_superuser,
        memberships=[
            MembershipPublic(
                workspace_id=m.workspace_id,
                role=m.role,
                workspace=WorkspacePublic.model_validate(m.workspace),
            )
            for m in memberships
        ],
    )


@router.patch("/auth/me", response_model=MeResponse)
async def update_own_name(
    body: NameUpdateRequest,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> MeResponse:
    """Update the current user's display name.

    This route lives under ``/api/v1/auth/me`` (not fastapi-users'
    unproxied ``/users/me``) so it is reachable through Nginx and Vite
    proxies without additional configuration.
    """
    old_name = user.name
    if old_name == body.name:
        # No-op — return current state without writing.
        memberships = await WorkspaceRepo(session).list_memberships_for_user(user.id)
        return MeResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            must_change_password=user.must_change_password,
            is_superuser=user.is_superuser,
            memberships=[
                MembershipPublic(
                    workspace_id=m.workspace_id,
                    role=m.role,
                    workspace=WorkspacePublic.model_validate(m.workspace),
                )
                for m in memberships
            ],
        )

    user.name = body.name
    session.add(user)
    await session.flush()

    await write_audit(
        session,
        workspace_id="",
        user_id=str(user.id),
        action="user.rename",
        metadata={"old_name": old_name, "new_name": body.name},
    )
    await session.commit()

    memberships = await WorkspaceRepo(session).list_memberships_for_user(user.id)
    return MeResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        must_change_password=user.must_change_password,
        is_superuser=user.is_superuser,
        memberships=[
            MembershipPublic(
                workspace_id=m.workspace_id,
                role=m.role,
                workspace=WorkspacePublic.model_validate(m.workspace),
            )
            for m in memberships
        ],
    )
