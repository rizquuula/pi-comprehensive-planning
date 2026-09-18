# Scope & Check Reference

Command reference for the `quick-review` skill. Everything here is read-only.

## Resolving the scope

```bash
# Uncommitted — working tree + staged, vs HEAD
git diff --name-only --diff-filter=ACMR HEAD
git ls-files -o --exclude-standard              # plus untracked files
git diff HEAD                                   # the diff itself

# Unpushed — commits on this branch not on its upstream
git rev-parse --abbrev-ref --symbolic-full-name '@{u}'   # find upstream; empty = none set
git rev-list --count '@{u}..HEAD'                        # 0 = nothing to review
git diff --name-only --diff-filter=ACMR '@{u}..HEAD'
git diff '@{u}..HEAD'

# Between version tags
git describe --tags --abbrev=0                  # latest tag
git describe --tags --abbrev=0 "$(git describe --tags --abbrev=0)^"   # the one before it
git diff --name-only --diff-filter=ACMR v1.2.0..v1.3.0
git tag --sort=-v:refname | head -5             # list recent tags

# Since a ref (branch review)
git diff --name-only --diff-filter=ACMR origin/main...HEAD    # three-dot: vs merge-base

# A pull request (read-only)
gh pr diff 123
gh pr view 123 --json baseRefName,headRefOid

# Fallback when the tree is clean and nothing is unpushed
git diff --name-only --diff-filter=ACMR HEAD~1..HEAD
```

### Two-dot vs three-dot

`A..B` is "what B has that A doesn't, as of A's current tip." `A...B` diffs from the **merge-base** — what the branch actually changed, ignoring commits that landed on `A` after the branch left.

Use `A...B` when reviewing a branch or PR against a moving base (`origin/main...HEAD`). Use `A..B` for two fixed points, like tags (`v1.2.0..v1.3.0`). Getting this backwards on a stale branch shows every commit that landed on main since you forked as part of "your" change.

### Filtering the file list

```bash
git diff --name-only --diff-filter=ACMR <range> \
  | grep -Ev '(^|/)(node_modules|\.venv|venv|__pycache__|dist|build|target|vendor)/' \
  | grep -Ev '(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|Cargo\.lock|\.min\.(js|css))$'
```

`--diff-filter=ACMR` drops deletions. Still confirm each path exists (`[ -f "$f" ]`) before passing it to a tool — a rename's old side and files deleted later in a range both survive the filter.

Narrow to paths by appending `-- src/ lib/foo.py` to any `git diff`.

## Checks by language

Pass the **scoped file list** to file-scoped tools. Tools marked *project-wide* can't take one — run them whole-project, then attribute findings only to changed files, and mark the check so a pre-existing failure isn't blamed on this change.

### Python

Drive Python tooling through **uv**. Which of `uv run` / `uvx` you want is not a style choice:

```bash
UVR="uv run --frozen --no-sync"           # never sync: no .venv/, no uv.lock rewrite

$UVR python -m py_compile $FILES          # syntax
uvx ruff check $FILES                     # lint
uvx ruff format --check $FILES            # format
uvx black --check $FILES                  # format, if the project uses black not ruff
$UVR mypy --no-error-summary $FILES       # types — must be `uv run`, see below
```

- **Always pass `--frozen --no-sync`.** A bare `uv run` *syncs the project environment first*: it will create `.venv/`, install dependencies, and may rewrite `uv.lock`. That silently violates the skill's read-only contract. `--no-sync` skips the sync; `--frozen` forbids touching the lockfile. (`--locked` is the stricter cousin — it *asserts* the lock is unchanged and errors otherwise.)
- **`uv run <tool>`** executes inside the project's environment, so the tool sees the project's installed dependencies and its pinned tool version. Required for `mypy`: run it via `uvx` and it can't import your third-party packages or their type stubs, so it invents a wall of `import-untyped` / `attr-defined` errors that vanish under `uv run`. Same for `pytest`.
- **`uvx <tool>`** (alias for `uv tool run`) fetches the tool into a throwaway environment, ignoring project deps. Correct for `ruff` and `black`, which only parse source and need no imports — and it means a repo that hasn't pinned `ruff` still gets linted.
- If the project pins its own linter (`ruff` in `[dependency-groups]` / `dev-dependencies`), prefer `$UVR ruff` so you match the version CI uses. `uvx ruff` may be newer and fire rules the project hasn't adopted.
- **`uv run` does not install anything.** It runs the tool from the project environment, so it fails with `error: Failed to spawn: \`mypy\`` when the project doesn't depend on it — that's a `SKIP` (the project has no mypy), not a type-check failure. `uvx mypy` would "succeed" here by fetching mypy into an empty environment, which is exactly the misleading run to avoid.
- `uv run` works outside a project too; there's just no project environment to draw from, so only already-installed tools resolve.

Bare `ruff`/`mypy`/`python` remain valid fallbacks when `uv` isn't installed.

### Go

```bash
gofmt -l $FILES                    # format — see note below
golangci-lint run                  # project-wide; prefer when .golangci.yml exists
go vet ./...                       # project-wide; fallback
staticcheck ./...                  # project-wide; fallback
```

`golangci-lint` bundles `go vet`, `staticcheck`, and more behind one call. If `.golangci.yml`/`.golangci.yaml` is present, run it *instead of* the other two — the project has already chosen its linter set, and running both double-reports.

`gofmt -l` **exits 0 even when files are misformatted** — it only prints their names. Treat non-empty stdout as the failure signal; the exit code alone always says "pass."

### Rust

```bash
cargo fmt --check                  # project-wide
cargo check --quiet                # project-wide
cargo clippy --quiet -- -D warnings # project-wide
```

Cargo is package-scoped throughout; there is no per-file mode. In a workspace, `-p <crate>` narrows to the crates the diff touches.

### TypeScript / JavaScript

```bash
npx --no-install tsc --noEmit      # project-wide; needs tsconfig.json
npx --no-install eslint $FILES     # lint
npx --no-install prettier --check $FILES
```

`--no-install` keeps a missing tool a `SKIP` instead of a silent network install mid-review.

### C++

```bash
clang-format --dry-run -Werror $FILES     # format — non-zero on a diff
clang-tidy $FILES -p build/               # lint; needs compile_commands.json
```

`clang-tidy` without a compile database (`-p` pointing at a CMake build dir containing `compile_commands.json`) can't resolve includes and will report garbage. No database → `SKIP`, don't guess flags.

### Kotlin

```bash
ktlint --relative $FILES           # lint + format
detekt --input "$(IFS=,; echo "${FILES[*]}")"   # comma-separated paths
```

### Dart / Flutter

```bash
dart format --set-exit-if-changed -o none $FILES   # format; -o none = don't write
dart analyze $FILES                                # lint + type errors
```

`dart format` **rewrites files in place by default** — `-o none` is what makes it a check. Never omit it.

## Detecting what's available

A tool that isn't installed or configured is a `SKIP` with a reason, never a `FAIL`.

```bash
command -v uv >/dev/null 2>&1                            # prefer uv for python
[ -f pyproject.toml ]                                    # `uv run` needs a project
command -v ruff >/dev/null 2>&1                          # bare-binary fallback
compgen -G ".eslintrc*" >/dev/null || compgen -G "eslint.config.*" >/dev/null
[ -f tsconfig.json ]
[ -f .golangci.yml ] || [ -f .golangci.yaml ]            # prefer golangci-lint if so
cargo clippy --version >/dev/null 2>&1                   # subcommand installed?
[ -f build/compile_commands.json ]                       # clang-tidy needs this
```

## Finding the tests that cover a change

To judge whether changed behavior is tested, locate the test file by the project's own convention before claiming none exists:

```bash
# Common layouts
ls tests/test_$(basename "$f" .py).py 2>/dev/null       # pytest: tests/test_foo.py
ls "${f%.go}_test.go" 2>/dev/null                        # go: foo.go -> foo_test.go
ls "${f%.ts}.test.ts" "${f%.ts}.spec.ts" 2>/dev/null      # js/ts: foo.test.ts
fd -e py -e go -e ts . tests/ test/ __tests__/ 2>/dev/null

# Does any test even mention the symbol?
git grep -n "func_name" -- '*test*'
```

A test file that exists but never names the changed symbol is the same as no coverage — say so, and name the case to add.
