#!/usr/bin/env python3
"""
Pre-Commit Guard for Suitest:
1. Prevents staging/committing local secrets (.env, .env.local, credentials, etc.)
2. Prevents unauthorized relaxation of .forgeguard/config.toml
3. Prevents committing local agent configs (.agents/*) or hardcoded dev ports (5173/8000)
"""

import os
import re
import subprocess
import sys
from pathlib import Path


def run_cmd(cmd: str) -> tuple[int, str]:
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return res.returncode, (res.stdout + "\n" + res.stderr).strip()


def check_forbidden_files(staged_files: list[str]) -> list[str]:
    errors: list[str] = []
    forbidden_suffixes = (".local", ".pem", ".key")
    for f in staged_files:
        if f.endswith(".example"):
            continue
        is_forbidden = (
            f == ".env"
            or f.startswith(".env.")
            or f.startswith(".agents/")
            or ".suitest-dev" in f
            or "credentials.json" in f
            or f.endswith(forbidden_suffixes)
        )
        if is_forbidden:
            errors.append(
                f"❌ [ANTI-LEAK] Attempted to commit private/local file: '{f}'\n"
                f"   -> Remedy: Unstage with 'git restore --staged {f}' and keep it in .gitignore."
            )
    return errors


def check_diff_leaks() -> list[str]:
    errors: list[str] = []
    _, diff_all = run_cmd("git diff --cached -- ':!scripts/git-hooks/pre_commit_guard.py'")
    if not diff_all:
        return errors

    # Check for dynamically resolved local home directory
    patterns: list[str] = []
    user_home = str(Path.home())
    if user_home and len(user_home) > 6 and not user_home.startswith(("/home/runner", "/root")):
        patterns.append(re.escape(user_home))

    # Optional local secret patterns from environment configuration
    env_patterns = os.environ.get("SUITEST_GUARD_SECRET_PATTERNS", "")
    if env_patterns:
        for p in env_patterns.split(","):
            p = p.strip()
            if p:
                patterns.append(re.escape(p))

    # Generic patterns for sensitive credentials or keys
    generic_key_regexes = [
        re.compile(r"SUITEST_ENCRYPTION_KEY=[a-zA-Z0-9+/=]{40,}"),
        re.compile(r"SUITEST_AUTH_SECRET=[a-zA-Z0-9+/=]{40,}"),
    ]

    home_pattern = (
        re.compile(r"^\+[ ]*.*(" + "|".join(patterns) + ")", re.MULTILINE)
        if patterns
        else None
    )

    if home_pattern and home_pattern.search(diff_all):
        errors.append(
            "❌ [ANTI-LEAK] Detected local absolute path in staged diff.\n"
            "   -> Remedy: Remove local path from staged changes."
        )

    for line in diff_all.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            added = line[1:].strip()
            if any(rgx.search(added) for rgx in generic_key_regexes):
                errors.append(
                    "❌ [ANTI-LEAK] Detected raw secret token in staged diff.\n"
                    "   -> Remedy: Remove credentials from staged changes and use .env."
                )
                break

    return errors


def check_port_tampering(staged_files: list[str]) -> list[str]:
    errors: list[str] = []
    targets = [
        ("apps/web/vite.config.ts", "apps/web/vite.config.ts"),
        ("Makefile", "Makefile"),
    ]
    for path, name in targets:
        if path not in staged_files:
            continue
        _, diff_out = run_cmd(f"git diff --cached -- {path}")
        for line in diff_out.splitlines():
            if (
                line.startswith("+")
                and not line.startswith("+++")
                and ("5173" in line or "8000" in line)
            ):
                errors.append(
                    f"❌ [ANTI-LEAK] Hardcoded dev port (5173/8000) staged in '{name}'.\n"
                    "   -> Remedy: Keep repo defaults clean. Use .env for local port overrides."
                )
                break
    return errors


def check_forgeguard_relaxation(staged_files: list[str]) -> list[str]:
    if ".forgeguard/config.toml" not in staged_files:
        return []

    _, diff_out = run_cmd("git diff --cached -- .forgeguard/config.toml")
    tampered = False
    reasons: list[str] = []
    for line in diff_out.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            added = line[1:].strip()
            if "block = false" in added or "block=false" in added:
                tampered = True
                reasons.append(f"Adding relaxation: '{added}'")
            if (
                'mode = "lite"' in added
                or 'mode = "default"' in added
                or 'mode="lite"' in added
                or 'mode="default"' in added
            ):
                tampered = True
                reasons.append(f"Lowering strictness mode: '{added}'")

    if tampered:
        return [
            "❌ [ANTI-LEAK] Unauthorized relaxation detected in staged '.forgeguard/config.toml':\n"
            + "\n".join(f"   • {r}" for r in reasons)
            + "\n   -> Remedy: Discard staged changes with 'git restore --staged .forgeguard/config.toml'."
        ]
    return []


def main():
    code, out = run_cmd("git diff --cached --name-only")
    if code != 0 or not out:
        sys.exit(0)

    staged_files = [f.strip() for f in out.splitlines() if f.strip()]
    if not staged_files:
        sys.exit(0)

    errors = (
        check_forbidden_files(staged_files)
        + check_diff_leaks()
        + check_port_tampering(staged_files)
        + check_forgeguard_relaxation(staged_files)
    )

    if errors:
        print("\n==================================================")
        print("🛑  [pre-commit hook] Commit Aborted by Policy Guard")
        print("==================================================")
        for e in errors:
            print(e)
        print("==================================================\n")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
