"""Run / run-step / log / artifact response DTOs (docs/API.md §3.5)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from suitest_shared.domain.enums import (
    ArtifactKind,
    RunStatus,
    StepOutcome,
)
from suitest_shared.schemas.responses import RunListOut


class PlaywrightConfig(BaseModel):
    """Playwright test runner execution settings (headless, capture, highlighting)."""

    model_config = ConfigDict(populate_by_name=True)

    headless: bool = True
    screenshot: Literal["off", "only-on-failure", "on"] = "only-on-failure"
    video: Literal["off", "retain-on-failure", "on"] = "off"
    video_quality: Literal["360p", "480p", "720p", "1080p"] = Field(
        default="1080p", alias="videoQuality"
    )
    highlight_steps: bool = Field(default=False, alias="highlightSteps")
    clean_session_between_cases: bool = Field(default=True, alias="cleanSessionBetweenCases")
    prevent_sleep: bool = Field(default=True, alias="preventSleep")


class RunSummary(BaseModel):
    """Aggregate step outcomes for a run."""

    total_steps: int
    passed_steps: int
    failed_steps: int
    duration_ms: int | None = None


class RunListItem(RunListOut):
    """List row for ``GET /runs`` (docs/API.md §3.5)."""

    summary: RunSummary | None = None


class RunCaseSummary(BaseModel):
    """Summary of a planned test case in a run (M1-15b)."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    case_id: str
    case_public_id: str
    case_title: str
    total_steps: int = 0


class RunDetail(RunListItem):
    """Detail for ``GET /runs/:id`` — adds the computed summary."""

    summary: RunSummary
    coverage_summary: dict[str, object] | None = None
    cases: list[RunCaseSummary] = Field(default_factory=list)
    playwright_config: PlaywrightConfig | None = Field(default=None, alias="playwrightConfig")
    error_message: str | None = Field(default=None, alias="errorMessage")


class RunStepPublic(BaseModel):
    """One run step with its outcome + linked case public id (docs/API.md §3.5)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    run_id: str
    case_id: str
    case_public_id: str
    # Legacy technical key of the case (kept for compatibility; may be a slug).
    case_name: str = ""
    # The case's human display title (``test_cases.title``) — what the run
    # detail renders as the case heading. Never a slug.
    case_title: str = ""
    step_order: int
    outcome: StepOutcome
    # Human-readable step instruction + kind, recorded in ``state_snapshot``.
    # ``title`` is the action/assertion sentence; ``type`` ∈ action | assertion |
    # navigation | wait | api. Empty/"action" when a step has no snapshot (backend).
    title: str = ""
    type: str = "action"
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None
    error_message: str | None = None
    # What the step's tool returned. A diagnostic step (an event recording, a
    # tree dump) carries its whole answer here, so leaving it out of the
    # response made the step look like it had done nothing at all.
    stdout: str | None = None


class StateChangePublic(BaseModel):
    """One key-level state change at a replay step (M5-1)."""

    model_config = ConfigDict(populate_by_name=True)

    path: str
    op: str = Field(description="added | removed | changed")
    before: str | None = None
    after: str | None = None


class RunReplayStep(BaseModel):
    """One step in the time-travel replay, with its state delta vs. the prior step."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    step_order: int = Field(serialization_alias="stepOrder")
    case_public_id: str = Field(serialization_alias="casePublicId")
    outcome: StepOutcome
    duration_ms: int | None = Field(default=None, serialization_alias="durationMs")
    started_at: datetime | None = Field(default=None, serialization_alias="startedAt")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")
    state_snapshot: dict[str, object] | None = Field(
        default=None, serialization_alias="stateSnapshot"
    )
    delta: list[StateChangePublic] = Field(default_factory=list)


class RunReplayResponse(BaseModel):
    """``GET /runs/:id/replay`` — ordered steps + per-step state delta (M5-1)."""

    model_config = ConfigDict(populate_by_name=True)

    run_id: str = Field(serialization_alias="runId")
    steps: list[RunReplayStep] = Field(default_factory=list)


class RunLogItem(BaseModel):
    """One persisted ``run_step_logs`` row in the page (M1c).

    ``message`` is the JSON-encoded event payload the orchestrator published —
    the FE deserialises it on receipt to match the live socket stream.
    """

    model_config = ConfigDict(populate_by_name=True)

    seq: int
    level: str
    message: str
    created_at: datetime = Field(serialization_alias="createdAt")

    @field_validator("created_at", mode="after")
    @classmethod
    def _ensure_utc(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            return v.replace(tzinfo=UTC)
        return v.astimezone(UTC)


class RunLogPage(BaseModel):
    """A cursor-paginated slice of a run's persisted log stream (M1c)."""

    model_config = ConfigDict(populate_by_name=True)

    items: list[RunLogItem] = Field(default_factory=list)
    next_cursor: int = Field(serialization_alias="nextCursor")
    has_more: bool = Field(serialization_alias="hasMore")


class ArtifactPublic(BaseModel):
    """One artifact in ``GET /runs/:id/artifacts`` (docs/API.md §3.5)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    run_step_id: str
    kind: ArtifactKind
    size_bytes: int
    mime_type: str
    created_at: datetime


class CaseArtifactPublic(BaseModel):
    """Historical artifact record for a test case across all its runs."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    run_id: str = Field(serialization_alias="runId")
    run_public_id: str = Field(serialization_alias="runPublicId")
    run_status: RunStatus | None = Field(default=None, serialization_alias="runStatus")
    run_date: datetime = Field(serialization_alias="runDate")
    run_step_id: str = Field(serialization_alias="runStepId")
    step_order: int = Field(serialization_alias="stepOrder")
    step_title: str | None = Field(default=None, serialization_alias="stepTitle")
    kind: ArtifactKind
    size_bytes: int = Field(serialization_alias="sizeBytes")
    mime_type: str = Field(serialization_alias="mimeType")
    created_at: datetime = Field(serialization_alias="createdAt")


class CaseRunPublic(BaseModel):
    """Historical run summary that executed a test case."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    public_id: str = Field(serialization_alias="publicId")
    status: RunStatus | None = None
    created_at: datetime = Field(serialization_alias="createdAt")
    started_at: datetime | None = Field(default=None, serialization_alias="startedAt")
    completed_at: datetime | None = Field(default=None, serialization_alias="completedAt")
    playwright_config: PlaywrightConfig | None = Field(
        default=None, serialization_alias="playwrightConfig"
    )


class ArtifactSignedUrl(BaseModel):
    """``GET /runs/:id/artifacts/:artifactId`` — presigned download URL (M1c).

    The M1a stub returned a placeholder URL alongside the artifact id + scheme;
    M1c replaces it with a real S3 / MinIO presign + the artifact's MIME type
    so the FE can decide how to render the response (inline image vs. download).
    """

    model_config = ConfigDict(populate_by_name=True)

    url: str
    expires_in_seconds: int = Field(serialization_alias="expiresInSeconds")
    kind: ArtifactKind
    mime_type: str = Field(serialization_alias="mimeType")


class RunsSummary(BaseModel):
    """``GET /runs/summary`` — counters for the Runs dashboard summary bar.

    Field aliases are camelCase to match the M1b frontend client.
    ``failed`` folds ``FAIL`` + ``ERROR``; ``avg_duration_ms`` is a workspace-wide
    weighted mean across non-null durations.
    """

    model_config = ConfigDict(populate_by_name=True)

    active: int = Field(description="Runs currently in RUNNING state")
    today: int = Field(description="Runs created since 00:00 UTC")
    passed: int
    failed: int = Field(description="FAIL + ERROR")
    avg_duration_ms: int = Field(alias="avgDurationMs")
    queued: int
    interrupted: int = Field(default=0, description="Runs in INTERRUPTED state")


class NetworkEvent(BaseModel):
    """One network event captured during a run (HAR-derived, M1c)."""

    model_config = ConfigDict(populate_by_name=True)

    method: str
    path: str
    status: int
    duration_ms: int = Field(alias="durationMs")
    started_at: datetime = Field(alias="startedAt")


class RunNetworkResponse(BaseModel):
    """``GET /runs/:id/network`` — bounded network event list (M1b stub)."""

    items: list[NetworkEvent] = Field(default_factory=list)
