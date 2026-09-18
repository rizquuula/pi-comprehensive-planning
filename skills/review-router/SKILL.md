---
name: review-router
description: Routing layer that maps a code-review or feature-planning request to the language and cross-cutting standards skills that apply, so the right best-practices skill is actually loaded. Use at the START of any code review (reviewing a diff, PR, or "review this code"), or when planning a new/large feature, to detect the language(s) involved (.py/.go/.rs and others) and pull in python-best-practices, golang-best-practices, or rust-best-practices alongside the relevant cross-cutting standards. Use when the user says "code review", "review the diff/PR/changes", "plan this feature", "design this", or before auditing a change set spanning one or more languages.
---

# Review Router

A dispatcher, not a content skill. Its one job: when a review or planning task starts, figure out **which standards skills apply** and load them before doing the work. Don't review from memory — route first, then apply the loaded standard.

---

## When this fires

- A code-review request: "review this", "review the diff/PR", a review skill the user invokes (`quick-review`), auditing a change set.
- A feature-planning request: "plan / design / break down" a new or large feature (pairs with `comprehensive-planning`).

Skip for trivial one-line fixes where no standard adds value.

---

## Step 1 — Detect the language(s)

Look at the files in scope (the diff, the named paths, or the feature's target package). Map by extension / ecosystem:

| Signal | Load |
|---|---|
| `.py`, `pyproject.toml`, `requirements.txt`, `ruff`/`mypy`/`pytest` | **python-best-practices** |
| `.go`, `go.mod`, goroutines, `context.Context` | **golang-best-practices** (+ `hexagonal-architecture-go` for layering) |
| `.rs`, `Cargo.toml`, ownership/`tokio`/`clippy` | **rust-best-practices** |
| `.cpp`/`.cc`/`.cxx`/`.hpp`/`.h`, `CMakeLists.txt`, smart pointers/RAII/templates/concepts | **cpp-best-practices** |
| `.kt`/`.kts`, `build.gradle.kts`, coroutines/`Flow`, Android/Ktor/Spring | **kotlin-best-practices** |
| `.dart`, `pubspec.yaml`, widgets/`setState`/Riverpod, Android·iOS·web app | **flutter-best-practices** |

A change set can span several — load each language skill that applies. If no language skill matches, fall back to `clean-code-standard` alone.

---

## Step 2 — Add the cross-cutting standards that apply

Language skill is the base layer. Layer these on top based on what the change touches:

| The change touches… | Also load |
|---|---|
| Any non-trivial code | `clean-code-standard` |
| New tests, or code that should have them | `test-driven-development` |
| External input, auth, secrets, an endpoint boundary | `secure-coding` |
| Domain model, aggregates, layering, new subsystem | `domain-driven-design`, `hexagonal-architecture-go` |
| REST/gRPC/proto surface | `api-contract-design` |
| Schema, migration, query, persistence | `database-and-migrations` |
| Logging, metrics, tracing, SLOs | `create-proper-logging` (logs); metrics and tracing have no skill — cover them directly |
| UI / front-end diff | `clean-ui-standard` (build or review) |
| User opted in with "design for growth" / "overengineer from the start", or project AGENTS.md names it | `design-for-growth` |

---

## Step 3 — Apply, don't just cite

- Open the loaded skill(s) and review/plan against their Do/Don't lists — name the specific rule a finding violates (`golang-best-practices §2: error not wrapped with %w`).
- Multiple languages → run each file against its own language standard; don't apply Go idioms to Python, or Rust ownership rules to C++.
- For planning, fold the relevant standards into the plan's "approach" and "risks" so the design starts compliant instead of being corrected in review.

---

## Don't

- Review or plan from memory when a matching standard exists — load it.
- Over-load: don't pull every skill onto a two-line change. Match the table, nothing more.
- Duplicate routing the user already did — if they invoked a specific skill, honor it and only add what's missing.
