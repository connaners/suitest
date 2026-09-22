"""``PATCH /users/me`` — self-service display name change.

``UserUpdate`` (FastAPI-Users) exposes ``name`` in addition to the stock
email/password fields; every other role/permission mutation is out of scope
here and already covered by ``test_m1e_passwords.py``.

The FastAPI-Users ``/users/me`` routes build their OWN ``current_user``
dependency closure inside ``get_users_router`` (see ``fastapi_users.router.
users``), distinct from the ``current_active_user`` singleton every other
Suitest route depends on. Overriding that singleton via ``api_db.client()``
(the Task 7 pattern used everywhere else) therefore does NOT authenticate
these routes — a real cookie login is required instead.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from api_harness import ApiDb
from asgi_lifespan import LifespanManager
from fastapi_users.password import PasswordHelper
from httpx import ASGITransport, AsyncClient
from suitest_api.auth.db import get_async_session
from suitest_api.main import create_app
from suitest_db.models.user import User


@asynccontextmanager
async def _logged_in_client(
    api_db: ApiDb, *, email: str, password: str
) -> AsyncIterator[AsyncClient]:
    """Real cookie login: exercises the actual FastAPI-Users auth dependency."""
    app = create_app()

    async def _override_session() -> AsyncIterator[object]:
        async with api_db.maker() as session:
            yield session

    app.dependency_overrides[get_async_session] = _override_session
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            login = await client.post(
                "/auth/cookie/login", data={"username": email, "password": password}
            )
            assert login.status_code == 204, login.text
            yield client


@pytest.mark.asyncio
async def test_user_can_rename_self(api_db: ApiDb) -> None:
    user = await api_db.seed_user(email="rename@example.com", name="Old Name")
    async with api_db.maker() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = PasswordHelper().hash("correct-password")
        await session.commit()

    async with _logged_in_client(
        api_db, email="rename@example.com", password="correct-password"
    ) as c:
        resp = await c.patch("/users/me", json={"name": "New Name"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "New Name"

        me = await c.get("/api/v1/auth/me")
        assert me.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_rename_rejects_empty_name(api_db: ApiDb) -> None:
    user = await api_db.seed_user(email="rename-empty@example.com", name="Kept Name")
    async with api_db.maker() as session:
        db_user = await session.get(User, user.id)
        assert db_user is not None
        db_user.hashed_password = PasswordHelper().hash("correct-password")
        await session.commit()

    async with _logged_in_client(
        api_db, email="rename-empty@example.com", password="correct-password"
    ) as c:
        resp = await c.patch("/users/me", json={"name": ""})
        assert resp.status_code == 422

        me = await c.get("/api/v1/auth/me")
        assert me.json()["name"] == "Kept Name"


@pytest.mark.asyncio
async def test_rename_unauthenticated_is_401(api_db: ApiDb) -> None:
    async with api_db.client(None) as c:
        resp = await c.patch("/users/me", json={"name": "Nope"})
        assert resp.status_code == 401
