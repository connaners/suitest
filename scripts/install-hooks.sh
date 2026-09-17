#!/usr/bin/env bash
# Installs local git hooks (pre-commit & pre-push) for Suitest

set -eo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

mkdir -p "$HOOKS_DIR"

chmod +x "$REPO_ROOT/scripts/git-hooks/pre_commit_guard.py"

cat << 'EOF' > "$HOOKS_DIR/pre-commit"
#!/usr/bin/env bash
set -eo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
python3 "$REPO_ROOT/scripts/git-hooks/pre_commit_guard.py"
EOF

chmod +x "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-push"
chmod +x "$HOOKS_DIR/pre_pr_review.py"

echo "✅ Git hooks installed successfully (pre-commit & pre-push)."
