"""Pydantic schemas exposed by FastAPI-Users routes."""

import uuid

from fastapi_users import schemas
from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated


class UserRead(schemas.BaseUser[uuid.UUID]):
    """Outbound user representation."""

    name: str


class UserCreate(schemas.BaseUserCreate):
    """Inbound payload for POST /auth/register."""


class UserUpdate(schemas.BaseUserUpdate):
    """Inbound payload for fastapi-users' built-in ``PATCH /users/me``.

    Only ``name`` is exposed — ``email``, ``password``, and the ``is_*``
    flags are excluded to prevent unauthorised changes via the public
    self-service endpoint.  ``create_update_dict()`` only forwards fields
    defined in the subclass, so hiding them here is sufficient.
    """

    # Hide parent fields so they are not accepted or documented.
    email: None = Field(default=None, exclude=True)
    password: None = Field(default=None, exclude=True)

    name: Annotated[
        str | None,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    ] = None


class NameUpdateRequest(BaseModel):
    """Inbound payload for ``PATCH /api/v1/auth/me`` (name only)."""

    name: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    ]
