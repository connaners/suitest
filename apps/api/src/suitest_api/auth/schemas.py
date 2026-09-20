"""Pydantic schemas exposed by FastAPI-Users routes."""

import uuid

from fastapi_users import schemas
from pydantic import Field


class UserRead(schemas.BaseUser[uuid.UUID]):
    """Outbound user representation."""

    name: str


class UserCreate(schemas.BaseUserCreate):
    """Inbound payload for POST /auth/register."""


class UserUpdate(schemas.BaseUserUpdate):
    """Inbound payload for PATCH /users/me."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
