---
name: quick-review
description: Fast, read-only review of a git-scoped change such as unpushed commits, uncommitted work, a version/tag range, PR, ref, or path. Resolves scope, runs language-tailored static checks over changed files, then one light pass for correctness bugs, cleanup, and missing tests. Reports blocker/major findings only. Never edits, commits, or pushes. Use when the user says "quick review", "/quick-review", "review my changes", "review unpushed commits", "check before I push", or "lint the diff". Covers Python, Go, Rust, TypeScript/JavaScript, C++, Kotlin, and Dart/Flutter.
---

# Quick Review

A fast, read-only pass over a **git-scoped** change. Resolve the scope, run the cheap deterministic checks over only the files in it, then read the diff once for the things a linter can't see — including tests that should exist and don't.

This is the light end of the review family. A deep review fans out specialist reviewers across several dimensions and adversarially verifies every finding; that takes minutes. This skill is meant to finish in the time it takes to decide whether to push, and it reports only what would make you *not* push.

**Read-only, always.** Never edit, stage, commit, push, or rewrite history. Never run test suites, builds, or migrations. Report; let the user act.

## Arguments

`/quick-review [scope] [-- paths...]`

| Scope | Resolves to | Use when |
|---|---|---|
| *(default)* | dirty tree → uncommitted; else unpushed; else `HEAD~1..HEAD` | "just review what I'm working on" |
| `--uncommitted` | `git diff HEAD` + untracked files | Before staging; work in progress |
| `--unpushed` | `@{u}..HEAD` | Before `git push` |
| `--tags` | previous tag → latest tag | "what shipped in this release" |
| `--range A..B` | `git diff A..B` | Between two versions, e.g. `v1.2.0..v1.3.0` |
| `--since <ref>` | `<ref>..HEAD` | Everything since `origin/main` |
| `--pr <n>` | `gh pr diff <n>` | Reviewing someone else's PR |
| `-- <paths>` | narrows any of the above | Targeted review of a subtree |

Resolve exactly one scope. If the user's words are ambiguous ("review my changes" with both a dirty tree *and* unpushed commits), state which you picked in the header rather than asking — the header makes it obvious and cheap to correct.

## Step 1 — Resolve the scope

Pick the scope from the table, then get the file list. Restrict to `ACMR` (added/copied/modified/renamed) — a deleted file has nothing to check:

```bash
git diff --name-only --diff-filter=ACMR <range> -- <paths>
git ls-files -o --exclude-standard          # untracked, for --uncommitted only
```

Drop from the list: `node_modules/`, `.venv/`, `venv/`, `__pycache__/`, `dist/`, `build/`, `target/`, `vendor/`, lockfiles (`package-lock.json`, `go.sum`, `Cargo.lock`, …), minified assets, and anything that no longer exists on disk (a rename's old side). Then confirm each remaining path exists before handing it to a tool.

**Stop early** — print "nothing to review" and exit — when the scope is empty, or when it is entirely generated code, lockfile churn, vendored code, or pure reformatting. Say which, so the user knows it wasn't skipped by accident.

**Large scopes:** past ~40 files, check everything but *review* only the highest-value slice — new files, public API and contract surfaces, security-sensitive paths, highest churn. Say "reviewed N of M changed files" in the summary. Never silently truncate.

## Step 2 — Static checks (changed files only)

Bucket the file list by extension — a mixed diff gets each language's checks over its own slice. Run only the tools that are actually installed and configured; a missing tool is a `SKIP` with the reason, never a failure. Full command reference: `references/scope-and-checks.md`.

Python goes through **uv**: `uvx` for tools that only parse (`ruff`, `black`), `uv run --frozen --no-sync` for tools that must import the project's dependencies (`mypy` — under `uvx` it can't see installed type stubs and emits phantom errors). **`--frozen --no-sync` is required, not optional:** a bare `uv run` syncs the environment first, which creates `.venv/` and can rewrite `uv.lock` — a review must not modify the working tree.

| Language | Syntax | Lint | Types | Format | Runs project code? |
|---|---|---|---|---|---|
| Python | `uv run --frozen --no-sync python -m py_compile` | `uvx ruff check` | `uv run --frozen --no-sync mypy --no-error-summary` | `uvx ruff format --check` (else `black`) | no |
| Go | — | `golangci-lint run` if configured, else `go vet ./...` + `staticcheck ./...` | — | `gofmt -l` | no |
| Rust | `cargo check` | `cargo clippy -- -D warnings` | — | `cargo fmt --check` | **yes** — compiles, runs `build.rs` |
| TypeScript | — | `eslint` | `tsc --noEmit` | `prettier --check` | **yes** — `eslint.config.js`, plugins |
| JavaScript | — | `eslint` | — | `prettier --check` | **yes** — `eslint.config.js` |
| C++ | — | `clang-tidy` | — | `clang-format --dry-run -Werror` | `clang-tidy` needs `compile_commands.json` |
| Kotlin | — | `ktlint`, `detekt` | — | `ktlint` | `detekt` loads project config |
| Dart / Flutter | — | `dart analyze` | — | `dart format --set-exit-if-changed -o none` | no |

The tools match what each `*-best-practices` skill declares — keep them in sync if a standard changes its tooling.

Three things worth getting right, because they're where a scoped check quietly lies:

- **File-scoped vs project-wide.** `ruff`, `mypy`, `eslint`, `prettier`, `gofmt`, and `ktlint` take an explicit file list — pass the scoped files and nothing else. `go vet ./...`, `staticcheck ./...`, `cargo check`, `cargo clippy`, and `tsc --noEmit` only work project-wide. Run those whole-project, but **attribute findings only to changed files**, and label the check `⋅ project` so the user knows a failure may predate their change.
- **`gofmt -l` exits 0 even when files are misformatted** — it just prints their names. Treat non-empty output as a failure; the exit code alone will tell you everything passed.
- **Some of these execute code from the repo**, per the last column: `cargo check`/`clippy` compile the crate and run `build.rs`; `eslint` executes `eslint.config.js`; `tsc` and `detekt` load project config and plugins. On a checkout you don't trust, run only the parse-only tools and mark the rest `SKIP (executes project code)`.

Cap noisy output at ~20 lines per failing check with a `… N more lines` marker. A static failure is worth reporting but does not stop Step 3 — the user wants both halves in one pass.

## Step 3 — The review pass

Read the diff once (`git diff <range>`), plus enough surrounding code to judge it. Do the pass in the main session and keep it scoped. For a second opinion, `pi --print "PROMPT"` runs an isolated reviewer — give it the scope label, diff, file list, and rubric below, and treat its output as advice, not verdict.

Load the matching standards rather than reviewing from memory: read `review-router` from this package to resolve which best-practices skill applies to the languages in scope, plus `clean-code-standard`. Pass the *paths*; open them yourself. Project instruction files (`AGENTS.md`, or host-specific equivalents) override the defaults on conflict.

Three dimensions, and only three — depth is what a dedicated deep-review skill is for:

1. **Correctness** — logic bugs, off-by-one, nil/null derefs, swallowed errors, unhandled edge cases, broken invariants, race conditions, misused APIs.
2. **Cleanup** — duplication of a helper that already exists, needless complexity, dead code, a materially simpler equivalent. Only when the win is obvious.
3. **Missing tests** — for each behavior the diff adds or changes, is there a test that would fail if the behavior regressed? Flag: new public functions and endpoints with no test at all; new branches, error paths, and edge cases the existing tests don't reach; tests that call the code but assert nothing meaningful (`assert result is not None` over a rich return value); a bug fix with no regression test pinning it.

   Don't just say "add a test." Name the case: the file it belongs in (following the project's existing test layout and naming), the specific input or state, and the assertion that would catch the regression. If the project has a test convention — table-driven in Go, `pytest` fixtures, `describe`/`it` — match it. When the diff genuinely needs no test (pure refactor with existing coverage, config, generated code), say so explicitly rather than staying silent, so the user knows it was considered.

**Report only `blocker` and `major`.** Minors and nits are noise at push time.

- **blocker** — will break in production, or violates an explicit project instruction: data loss, security hole, crash on a realistic input, broken public contract, correctness bug on a common path.
- **major** — clearly wrong or risky: incorrect on an edge case, missing error handling, an untested critical path, a design violation that will bite.

Ignore pre-existing issues on lines the diff didn't touch, anything the linters in Step 2 already own (formatting, import order), and decisions already documented in project instructions. Every finding cites `file:line` and quotes the diff line it rests on. **A finding you can't cite is a finding you don't report** — with no verification pass to catch a hallucinated one, the bar for asserting something is wrong is that you can point at it.

## Step 4 — Report

Terminal only. No emojis, no PR comments, no files written.

```
quick-review — unpushed commits (3 vs origin/main) · 7 files

STATIC
  lint (ruff)                PASS
  types (mypy)               FAIL
      src/api.py:42: Argument 1 to "fetch" has incompatible type "str | None"
  format (ruff)              PASS
  vet (go vet) ⋅ project     SKIP (go not installed)

REVIEW
  BLOCKER  src/api.py:88 — retry loop never exits on a 5xx
      while not ok:  # `ok` is never reassigned inside the loop
      A transient upstream error hangs the request thread indefinitely.
      Fix: set `ok = resp.ok` after the call, and cap attempts.

  MAJOR    src/db.py:14 — N+1 query on user lookup
      for u in users: rows.append(fetch_profile(u.id))
      One query per user; 200 users is 200 round-trips on a hot path.
      Fix: batch with `fetch_profiles([u.id for u in users])`.

TESTS
  MAJOR    src/api.py:88 — no coverage for the 5xx retry path
      tests/test_api.py has no test that drives `fetch` to a non-2xx response.
      Add: test_fetch_retries_then_raises_on_persistent_5xx — patch the transport
      to return 503 three times, assert it raises RetryExhausted after 3 attempts
      rather than looping.

Result: 1 static check failed · 2 findings · 1 missing test
Highest leverage: fix the retry loop in src/api.py:88 before pushing.
```

Omit any section with nothing in it. If everything passes and nothing is found, say so in one line — "quick-review — unpushed (3 commits) · 7 files · clean" — and stop.

End with a single summary line: static pass/fail counts, finding counts, "reviewed N of M files" if Step 1 capped, and the one highest-leverage thing to fix. If nothing blocks, say the change looks safe to push.

## Handing off

- Findings the user wants fixed → apply them directly (small) or plan them with `comprehensive-planning` (larger). Use the repository's commit rules; default to Conventional Commits, no `Co-Authored-By`, and push the base branch automatically after the commit.
- User wants depth — security, architecture, performance, verified findings → read the matching standards via `review-router` and do a second pass; there is no multi-agent reviewer here.
- User wants the tests actually written and run → `test-driven-development`.
