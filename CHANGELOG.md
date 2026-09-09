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

## [0.11.1](https://github.com/suiflex/suitest/compare/v0.11.0...v0.11.1) (2026-09-09)


### Bug Fixes

* **agent:** report a missing LLM client instead of crashing ([c731f49](https://github.com/suiflex/suitest/commit/c731f493f4bac1ee4858c950c72f5900c74f3b82))
* **npx:** install the LLM client into the bundle venv ([83ee80b](https://github.com/suiflex/suitest/commit/83ee80ba5f0df6a99d8df69cc4bdcdcfc531b5ba))
* **npx:** keep the stack alive after the launcher exits on Windows ([a46e72c](https://github.com/suiflex/suitest/commit/a46e72cad832df5e4f099b5df74e18b7102aaa79))

## [0.11.0](https://github.com/suiflex/suitest/compare/v0.10.0...v0.11.0) (2026-09-08)


### Features

* **agent-panel:** strip inline tool-call JSON before display ([6babc66](https://github.com/suiflex/suitest/commit/6babc661b15e1d99a7f9d9d9c9abfe9ef39da7c6))
* **agent-panel:** working indicator, auto-scroll, auto-approve toggle ([edaaf55](https://github.com/suiflex/suitest/commit/edaaf555109781898f0fc03fef1a64b63eaef776))
* **agent:** tool approval buttons and reload-safe chat history ([86700b8](https://github.com/suiflex/suitest/commit/86700b84ac660cb8603667bbe94ca023852c8fc4))
* **agent:** tool-use loop so the panel can read and edit test cases ([9e8b525](https://github.com/suiflex/suitest/commit/9e8b5259cba8b8cacd0794d00eead8d5f9db25af))
* **cases:** inline editable steps tab with drag-reorder and outcome badges ([97a07a2](https://github.com/suiflex/suitest/commit/97a07a2f45d7d61883bf84a11f9e207e85b162ce))
* **dashboard:** first-run onboarding checklist and project bootstrap ([25583af](https://github.com/suiflex/suitest/commit/25583af77ce1c5aa605ffaf293c4ae898510ab74))
* **docs-site:** add google analytics tag ([65abb0e](https://github.com/suiflex/suitest/commit/65abb0e50079630925f955421f538e11cc65cd15))
* **docs-site:** add google analytics tag to landing page ([7ca025d](https://github.com/suiflex/suitest/commit/7ca025de184de2c4fdb41b2c947ac60c7035c505))
* **docs-site:** add google analytics tag to landing page ([06fc2f4](https://github.com/suiflex/suitest/commit/06fc2f436ab1cdfb51a1dac8a185932fcfbf9deb))
* **docs-site:** move google analytics tag to the docs site ([64a6678](https://github.com/suiflex/suitest/commit/64a6678d37ae707dc8432b9a3327efab03f852a3))
* **runs:** add re-run and edit-case entry points to run detail ([a1cc687](https://github.com/suiflex/suitest/commit/a1cc687f1dfe5383d1ff09af9f486390b5a3d3b7))
* **web:** add google analytics tag ([34dc274](https://github.com/suiflex/suitest/commit/34dc2741b6269c9aef9cb6a212050f036bf7b43c))


### Bug Fixes

* **agent-panel:** approve tool calls by opaque call_id ([30be1b6](https://github.com/suiflex/suitest/commit/30be1b6e613033bdd09e94405d959e6ec4d79912))
* **agent:** authorize chat writes only from a recorded pending call ([5db0cd3](https://github.com/suiflex/suitest/commit/5db0cd3661b4bcb1fc178ff6a60b019bf87ec586))
* **agent:** keep partial case.update_meta from clearing unset fields ([18a8c98](https://github.com/suiflex/suitest/commit/18a8c98a4828f2f2b926df3be2067057b8c3df81))
* **api:** accept empty-action draft steps in bulk step replace ([58e40b9](https://github.com/suiflex/suitest/commit/58e40b9a994563fcfaf5574d6535310d32e7d9b3))
* **api:** allow draft steps with empty action in append and relax strict code check ([75ff199](https://github.com/suiflex/suitest/commit/75ff199494af685352ddc75bddf22d1a80a91c44))
* **api:** require code for real-action steps in strict zero validation ([f3bfb21](https://github.com/suiflex/suitest/commit/f3bfb214b430aaecddd711cc084c075a776bd326))
* **api:** resolve steps by internal id when case addressed by public id ([80fcd95](https://github.com/suiflex/suitest/commit/80fcd95e1b6f1d11b0128a7ea3849af30176a545))
* **cases:** New step creates a local draft instead of hitting the API ([01b0a41](https://github.com/suiflex/suitest/commit/01b0a41aaf21b980738bdfb65144b1d2f8384c93))
* **cases:** responsive bulk bar and draggable list-detail splitter ([e457b87](https://github.com/suiflex/suitest/commit/e457b8787890cc273aedf3950181b028f419de06))
* **ci:** refresh openapi snapshot, de-duplicate tool parsing, drop stale e2e disclosure click ([6ca59bf](https://github.com/suiflex/suitest/commit/6ca59bfaa25a675d402f4937832fb9d28a9d10a7))
* **dashboard:** scope onboarding dismissal per workspace ([e79221f](https://github.com/suiflex/suitest/commit/e79221f46cd0fb56c15b432ffc54b6fb9d965233))
* **docs-site:** use the docs site GA4 measurement id ([4f1017b](https://github.com/suiflex/suitest/commit/4f1017bcb4b4753999fd44c27eca2fc5e289a403))
* **invites:** bind acceptance to the invited email and stop account takeover ([6769bad](https://github.com/suiflex/suitest/commit/6769badb3ede085046b02a02d838b9fb315fa1ba))
* **invites:** only claim the explicit placeholder credential ([ab5b119](https://github.com/suiflex/suitest/commit/ab5b1194004d973466ce5e18d74b6137f222c675))


### Miscellaneous Chores

* collapse release-please to one workspace version ([e28741c](https://github.com/suiflex/suitest/commit/e28741c6b86c048932d9aa3f613f811f78962c9e))

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
