// Build the docs-site "Release notes" page from the root CHANGELOG.md.
//
// release-please owns CHANGELOG.md (it writes it on every release PR), so the
// docs must not keep a second hand-written copy — that copy is what goes stale.
// This script is the only place the two are joined, and it runs from `predev` /
// `prebuild`, so every dev server and every deploy regenerates the page.
// Updating the site after a release is therefore: nothing.
//
// Run manually: node scripts/sync-changelog.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const out = resolve(here, "..", "src/content/docs/docs/changelog.md");

const version = JSON.parse(
  readFileSync(resolve(repo, "packages/suitest-npx/package.json"), "utf8"),
).version;

/** Drop the `# Changelog` title and demote every heading one level below ours. */
function body(markdown) {
  return markdown
    .replace(/^#\s+Changelog\s*/, "")
    .trim()
    .replace(/^(#{2,5})\s/gm, "#$1 ");
}

const changelog = body(
  readFileSync(resolve(repo, "CHANGELOG.md"), "utf8"),
);

const page = `---
title: Release notes
description: Every released version of Suitest, with the changes in each — generated from the changelog.
editUrl: false
---

The whole Suitest workspace shares one version. Every release publishes the
launcher (\`@suiflex/suitest\`), the MCP server (\`@suiflex/suitest-mcp\`), both
SDKs and the CLI together on one \`vX.Y.Z\` tag.

Current: **${version}** · [releases](https://github.com/suiflex/suitest/releases)

${changelog}

---

*This page is generated from \`CHANGELOG.md\` by
\`docs-site/scripts/sync-changelog.mjs\` on every build. Edit the changelog (or
let release-please write it), not this page.*
`;

writeFileSync(out, page);
console.log(`sync-changelog: wrote ${out}`);
