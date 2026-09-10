"""Portable column types across dialects (PostgreSQL + SQLite)."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Text, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB

# JSONB on PostgreSQL, text-based JSON on SQLite/other dialects.
PortableJSON = JSON().with_variant(JSONB(astext_type=Text()), "postgresql")


class UtcDateTime(TypeDecorator[datetime]):
    """DateTime type that always ensures timezone=True and forces UTC timezone on read/write.

    On SQLite, native DateTime loses tzinfo when read back from the database.
    UtcDateTime guarantees that any datetime loaded from or stored in SQLite
    or PostgreSQL is a timezone-aware UTC datetime.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if value is not None and isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value.astimezone(UTC)
        return value

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        if value is not None and isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value.astimezone(UTC)
        return value
