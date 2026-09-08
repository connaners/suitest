#!/usr/bin/env python3
"""Self-check for attribute_changelog.py. Run: python3 test_attribute_changelog.py"""

from attribute_changelog import attribute

# sha -> (login, name, email)
AUTHORS = {
    "aaa": ("ekacahya21", "Eka Cahya", "eka@example.com"),
    "bbb": ("wahyuakbarwibowo", "Wahyu Akbar", "wahyu@example.com"),
    "ccc": ("mulhamna", "Mulham", "mulham@example.com"),
    "ddd": (None, "Anon Person", "anon@example.com"),
    "eee": ("ekacahya21", "Eka Cahya", "eka@example.com"),
}

ROOT = """# Changelog

Some preamble about unified versioning.

<!-- release-please writes new releases directly under this line -->

## [0.11.0](https://github.com/suiflex/suitest/compare/v0.10.0...v0.11.0) (2026-08-03)


### Features

* **mcp:** shiny new thing ([aaa](https://github.com/suiflex/suitest/commit/aaaaaa))
* **launcher:** another new thing ([eee](https://github.com/suiflex/suitest/commit/eeeeee))


### Bug Fixes

* **api:** fix a thing ([bbb](https://github.com/suiflex/suitest/commit/bbbbbb))
* **ci:** a maintainer chore ([ccc](https://github.com/suiflex/suitest/commit/cccccc))

## Historical milestones (pre-0.11)

### v0.5.0-m1d — closeout

Old stuff.
"""


def _resolve(sha):
    return AUTHORS[sha]


def test_appends_handle_before_the_commit_link():
    out = attribute(
        ROOT, resolve=_resolve, history=lambda t: {"eka@example.com", "wahyu@example.com"}
    )
    assert "* **mcp:** shiny new thing (@ekacahya21) ([aaa]" in out, out
    assert "* **api:** fix a thing (@wahyuakbarwibowo) ([bbb]" in out, out


def test_maintainer_commits_are_left_untouched():
    out = attribute(
        ROOT, resolve=_resolve, history=lambda t: {"eka@example.com", "wahyu@example.com"}
    )
    assert (
        "* **ci:** a maintainer chore ([ccc](https://github.com/suiflex/suitest/commit/cccccc))"
        in out
    )
    assert "@mulhamna" not in out


def test_thanks_section_lists_non_maintainers_deduped():
    out = attribute(
        ROOT, resolve=_resolve, history=lambda t: {"eka@example.com", "wahyu@example.com"}
    )
    top = out.split("## Historical milestones")[0]
    assert "### Thanks" in top
    assert top.count("* @ekacahya21\n") == 1, top
    assert "* @wahyuakbarwibowo\n" in top


def test_new_contributors_are_those_absent_from_history():
    root = ROOT.replace(
        "* **ci:** a maintainer chore ([ccc](https://github.com/suiflex/suitest/commit/cccccc))",
        "* **cli:** anon fix ([ddd](https://github.com/suiflex/suitest/commit/dddddd))",
    )
    out = attribute(root, resolve=_resolve, history=lambda t: {"eka@example.com"})
    top = out.split("## Historical milestones")[0]
    assert "### New Contributors" in top
    assert "* @wahyuakbarwibowo made their first contribution" in top
    assert "* Anon Person made their first contribution" in top
    assert "@ekacahya21 made their first contribution" not in top


def test_historical_section_is_untouched():
    out = attribute(ROOT, resolve=_resolve, history=lambda t: set())
    tail = out.split("## Historical milestones")[1]
    assert tail.strip() == "(pre-0.11)\n\n### v0.5.0-m1d — closeout\n\nOld stuff."


def test_is_idempotent():
    once = attribute(ROOT, resolve=_resolve, history=lambda t: {"eka@example.com"})
    twice = attribute(once, resolve=_resolve, history=lambda t: {"eka@example.com"})
    assert once == twice


def test_maintainer_only_release_gets_no_sections():
    root = """# Changelog

## [0.11.0](https://github.com/suiflex/suitest/compare/v0.10.0...v0.11.0) (2026-08-03)


### Bug Fixes

* **ci:** a maintainer chore ([ccc](https://github.com/suiflex/suitest/commit/cccccc))
"""
    out = attribute(root, resolve=_resolve, history=lambda t: set())
    assert out == root
    assert "### Thanks" not in out


if __name__ == "__main__":
    cases = sorted((name, fn) for name, fn in globals().items() if name.startswith("test_"))
    for name, fn in cases:
        fn()
        print(f"ok {name}")
    print("all checks passed")
