# Changelog

Single changelog for the whole Suitest workspace. From `0.11.0` on, every
published package — `@suiflex/suitest` (launcher), `@suiflex/suitest-mcp`,
`suiflex-suitest-lifecycle`, `suiflex-suitest-sdk`, `@suiflex/suitest-sdk`,
`suiflex-suitest-cli` — shares one version and ships on one `vX.Y.Z` tag.
Entries keep their `**scope:**` prefix (`mcp`, `launcher`, `api`, `cli`, …)
so each release still shows which parts moved.

Maintained by release-please; do not hand-edit the generated release
sections below.

<!-- release-please writes new releases directly under this line -->

## Historical milestones (pre-0.11)

Before `0.11.0` each package versioned independently. Per-package detail lives
in the git tags (`launcher-v*`, `mcp-v*`, `lifecycle-v*`, `tssdk-v*`,
`pysdk-v*`, `cli-v*`) and in the per-package `CHANGELOG.md` files as they
stood in those tags' trees. The milestone tags that predate package-level
versioning:

### v0.5.0-m1d — M1d — ZERO-mode closeout: manual TCM writes + integrations (2026-05-31)

Closes the ZERO tier. Full manual Test Case Management write surface,
soft-delete/restore, rule-based defect auto-filing, issue-tracker + webhook
integrations, and the frontend write UI — all deterministic, no LLM. 75
commits since ``v0.4.0-m1c``; every M1d-1..M1d-33 acceptance box green.

- **Backend writes** — manual TCM writes with a ZERO-tier validator and
  optimistic concurrency; soft-delete + restore for cases/suites/projects/
  requirements; suite/project/requirement CRUD; bulk-update; ad-hoc run
  shortcut; manual defects + rule-based auto-filer/categoriser; admin audit
  log; workspace settings.
- **Integrations** — `IssueTrackerAdapter` protocol + registry; Jira, GitHub,
  Linear, Slack; webhook receivers for GitHub/GitLab/Jira; integration CRUD
  with AES-GCM at rest.
- **Frontend** — `<SplitGenerateButton>`, `<ManualCreateModal>`,
  `<CaseEditor>` route, inline step editor, bulk-ops action bar, `<Toaster>` +
  `undoToast`, interactive defect cards, integrations page, admin audit-log
  table, workspace settings.
- **Quality gates** — auto-defect E2E, golden-path Playwright E2E + `m1d-e2e`
  workflow, visual-regression spec + state audit across the data screens.

Annotated tag ``v0.5.0-m1d``.

### v0.4.0-m1c — M1c — Runner + MCP runtime complete (2026-05-29)

ZERO-tier runner + MCP runtime fully wired. Reproduces the full
``create → enqueue → execute → stream → artifact`` loop end-to-end against
the docker-compose stack.

- **packages/mcp** — generic async MCP client (stdio / SSE / WS / in-process),
  connection pool, registry + routing table, health monitor, invoker,
  workspace session cap.
- **Bundled MCP providers** — `api-http-mcp`, `playwright-mcp`, `postgres-mcp`.
- **apps/runner** — ARQ worker + lifecycle, step executor, run orchestrator,
  artifact pipeline to S3/MinIO.
- **apps/api** — authenticated WebSocket gateway, `POST /runs` +
  cancel/rerun, persisted run-step logs, presigned artifact URLs.
- **apps/web** — run detail page on the live WS stream, MCP provider browser.
- **DoD smoke E2E** — `tests/e2e/test_m1c_smoke.py`.

Scheduled cron runs deferred to M1d. Annotated tag ``v0.4.0-m1c``.

### v0.3.0-m1b — M1b — ZERO Frontend Read-only complete

App shell, capability boot, read-only screens (Dashboard, Test Cases, Runs,
Defects, Requirements, Analytics, Integrations, Inbox, Audit).

### v0.2.0-m1a — M1a — Backend foundation + seed

FastAPI app, FastAPI-Users JWT auth, capability resolver, read endpoints
across the M1a surface, full Nusantara Retail seed.

### v0.1.0-m0 — M0 — Monorepo skeleton

Initial monorepo skeleton (apps/, packages/, infra/, docs/, pre-commit).
