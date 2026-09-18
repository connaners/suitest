"""Add INTERRUPTED to run_status enum (Issue #191).

Revision ID: 0052_add_run_status_interrupted
Revises: 0051_remove_capability_tiers
Create Date: 2026-09-18
"""

from __future__ import annotations

from alembic import op

revision: str = "0052_add_run_status_interrupted"
down_revision: str | None = "0051_remove_capability_tiers"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    bind = op.get_bind()
    # Only Postgres stores run_status as a real ENUM type; add the new value
    # there. SQLite represents enums as VARCHAR, so the value is picked up
    # automatically from the application enum without altering columns.
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'INTERRUPTED'")


def downgrade() -> None:
    # PostgreSQL cannot remove a value from an enum type without recreating it.
    pass
