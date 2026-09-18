"""``python -m suitest_db.bootstrap`` creates the local schema from env."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path


def test_module_cli_creates_sqlite_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "suitest.db"
    env = {
        **os.environ,
        "SUITEST_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}",
    }
    result = subprocess.run(
        [sys.executable, "-m", "suitest_db.bootstrap"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        conn.close()
    assert "runs" in tables
    assert len(tables) > 30


def test_module_cli_fails_cleanly_without_env() -> None:
    env = {k: v for k, v in os.environ.items() if k != "SUITEST_DATABASE_URL"}
    result = subprocess.run(
        [sys.executable, "-m", "suitest_db.bootstrap"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "SUITEST_DATABASE_URL" in result.stderr


def test_module_cli_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "suitest.db"
    env = {**os.environ, "SUITEST_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, "-m", "suitest_db.bootstrap"],
            env=env,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr


def test_bootstrap_drops_legacy_columns_on_existing_db(tmp_path: Path) -> None:
    db_path = tmp_path / "suitest.db"
    env = {**os.environ, "SUITEST_DATABASE_URL": f"sqlite+aiosqlite:///{db_path}"}
    # 1. First bootstrap to create base schema
    result = subprocess.run(
        [sys.executable, "-m", "suitest_db.bootstrap"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    # 2. Simulate an older release schema by injecting legacy NOT NULL columns and indexes
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "ALTER TABLE runs ADD COLUMN tier_at_runtime VARCHAR(5) NOT NULL DEFAULT 'ZERO'"
        )
        conn.execute("CREATE INDEX ix_runs_tier ON runs (tier_at_runtime)")
        conn.execute(
            "ALTER TABLE workspace_capabilities ADD COLUMN tier VARCHAR(5) NOT NULL DEFAULT 'ZERO'"
        )
        conn.execute("CREATE INDEX ix_workspace_capabilities_tier ON workspace_capabilities (tier)")
        conn.execute(
            "ALTER TABLE workspaces ADD COLUMN strict_zero_validation BOOLEAN DEFAULT 1 NOT NULL"
        )
        # Generic orphaned column without default: simulate an old table column removed from model
        # To simulate a NOT NULL column without default in SQLite, create a temporary table without default
        conn.execute("CREATE TABLE custom_old (id TEXT PRIMARY KEY, orphaned_col TEXT NOT NULL)")
        conn.commit()
    finally:
        conn.close()

    # Verify they exist before upgrade
    conn = sqlite3.connect(db_path)
    try:
        cols_before = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
        assert "tier_at_runtime" in cols_before
    finally:
        conn.close()

    # 3. Run bootstrap again (simulating upgrade to new version)
    result = subprocess.run(
        [sys.executable, "-m", "suitest_db.bootstrap"],
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr

    # 4. Verify legacy columns and indexes were cleanly removed
    conn = sqlite3.connect(db_path)
    try:
        cols_runs = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
        assert "tier_at_runtime" not in cols_runs

        indexes = {row[1] for row in conn.execute("PRAGMA index_list(runs)")}
        assert "ix_runs_tier" not in indexes

        cols_caps = {row[1] for row in conn.execute("PRAGMA table_info(workspace_capabilities)")}
        assert "tier" not in cols_caps

        cols_ws = {row[1] for row in conn.execute("PRAGMA table_info(workspaces)")}
        assert "strict_zero_validation" not in cols_ws
    finally:
        conn.close()
