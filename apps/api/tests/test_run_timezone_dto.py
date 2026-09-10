"""Tests for Run DTOs UTC timezone serialization (Issue #176)."""

import json
from datetime import UTC, datetime

from suitest_api.schemas.run import RunReplayStep, RunStepPublic
from suitest_api.schemas.runs import RunPublic
from suitest_shared.domain.enums import RunStatus, RunTrigger, StepOutcome, Tier


def test_run_public_serializes_timestamps_with_z() -> None:
    utc_dt = datetime(2026, 9, 10, 10, 0, 0, tzinfo=UTC)
    run = RunPublic(
        id="run_1",
        public_id="R-1",
        project_id="proj_1",
        name="api-stg.oss.go.id blackbox run",
        branch="main",
        commit_sha=None,
        env="staging",
        trigger=RunTrigger.MANUAL,
        status=RunStatus.PASS,
        tier_at_runtime=Tier.ZERO,
        started_at=utc_dt,
        completed_at=utc_dt,
        duration_ms=450,
        total_steps=5,
        passed_steps=5,
        failed_steps=0,
        created_at=utc_dt,
    )

    data = run.model_dump(mode="json", by_alias=True)
    assert data["startedAt"] == "2026-09-10T10:00:00Z"
    assert data["completedAt"] == "2026-09-10T10:00:00Z"
    assert data["createdAt"] == "2026-09-10T10:00:00Z"

    json_str = run.model_dump_json(by_alias=True)
    parsed = json.loads(json_str)
    assert parsed["startedAt"] == "2026-09-10T10:00:00Z"
    assert parsed["completedAt"] == "2026-09-10T10:00:00Z"


def test_run_step_public_serializes_timestamps_with_z() -> None:
    utc_dt = datetime(2026, 9, 10, 10, 5, 0, tzinfo=UTC)
    step = RunStepPublic(
        id="step_1",
        run_id="run_1",
        case_id="case_1",
        case_public_id="TC-100",
        step_order=1,
        outcome=StepOutcome.PASS,
        started_at=utc_dt,
        completed_at=utc_dt,
    )

    data = step.model_dump(mode="json")
    assert data["started_at"] == "2026-09-10T10:05:00Z"
    assert data["completed_at"] == "2026-09-10T10:05:00Z"


def test_run_replay_step_serializes_timestamps_with_z() -> None:
    utc_dt = datetime(2026, 9, 10, 10, 6, 0, tzinfo=UTC)
    replay_step = RunReplayStep(
        id="step_1",
        step_order=1,
        case_public_id="TC-100",
        outcome=StepOutcome.PASS,
        started_at=utc_dt,
    )

    data = replay_step.model_dump(mode="json", by_alias=True)
    assert data["startedAt"] == "2026-09-10T10:06:00Z"
