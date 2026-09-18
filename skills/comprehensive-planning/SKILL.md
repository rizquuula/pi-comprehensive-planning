---
name: comprehensive-planning
description: Produce a reviewable implementation plan (goal, success criteria, file tree, flow diagram, steps, ordered slices and worktrees, risks, validation, rollout) before non-trivial work. Trigger when the user says "plan/design/think through/break down", or when work spans 3+ files, a new module, an external integration, a schema/data migration, or an architectural change. Skip single-file fixes, lookups, and "just do it" requests.
---

# Comprehensive Planning

Write the plan for a reader who does not know this codebase.
Use short sentences. Use plain words. Put one idea in one sentence.
The reader must understand what changes, where it changes, and how the parts connect.

## Harness notes

This skill assumes a single-writer agent, which is how pi runs. Two consequences shape it:

- **One writer.** pi has no subagent tool. Plan the work in ordered slices and execute them yourself,
  one at a time. If the user explicitly asks for a parallel run, isolate each writer in its own
  worktree and give it disjoint files — never two writers on one checkout.
- **Worktrees are plain git.** Isolation is `git worktree` in bash, not a harness feature.

## Workflow

1. **Restate the goal** in one sentence if it is unclear. Ask one question at most, then continue.
2. **Write the success criteria** (§1a) first. If you cannot write them, the goal is too vague.
3. **Ground the plan.** Read the files you will touch. Check how the project already does this.
4. **Draft the plan** with the template below. Skip a section when it adds nothing.
5. **Draw the file tree (§6) and the flow diagram (§7).** Both are required for any plan that touches 2 or more files.
6. **Cut the work into test-first cycles (§8).** Every cycle runs red, then green, then refactor.
7. **Split the work (§9).** Order the cycles into slices and say what each slice owns.
8. **Present the plan for review** before you write code. Ask: "anything to adjust before I start?"
9. **Update the plan during the work** when reality is different. Add a short note.
10. **Close the loop.** Confirm each success criterion. List the follow-ups you found.

## Extra triggers

Plan also when the change is hard to undo (data migration, public API, auth).
Plan also when more than one good approach exists.
Skip the plan when the user says "just do it".

## Apply the language and cross-cutting standards

Load the standards for the languages in scope before you draft §5 (Approach).
The design then starts correct instead of being corrected in review.
Read a skill with the `read` tool (pi lists every skill's path in the system prompt, or run `/skill:<name>`).
The language skills keep their detail in a `references/` folder next to the file — read the ones you need.
Let `review-router` pick the set, or go direct:

- **Python** → `python-best-practices` · **Go** → `golang-best-practices` (add `hexagonal-architecture-go` for layering) · **Rust** → `rust-best-practices` · **C++** → `cpp-best-practices`
- **Kotlin** → `kotlin-best-practices` · **Flutter/Dart** (Android · iOS · web) → `flutter-best-practices`
- Cross-cutting, when the change needs it: `clean-code-standard`, `test-driven-development`, `secure-coding`, `solid-principle`, `domain-driven-design`, `api-contract-design`, `database-and-migrations`, `clean-ui-standard` (UI work), `create-proper-logging` (logs), `design-for-growth` (opt-in only).

This package ships no metrics or tracing skill. Load `create-proper-logging` for the log side, and cover metrics and tracing yourself in §5 and §11d.

Fold the rules that apply into §5 (Approach) and §10 (Risks).

## Plan template

Keep each section short. Skip a section when it is trivial.
Target: the reader finishes the plan in under 3 minutes.

### 1. Goal
One sentence. What does the user see when this works?

**1a. Success criteria (testable).**
Write one main criterion. Add 1–3 more only if you need them.
Each criterion must be observable: a test, a metric, or a manual demo.
Use numbers, not adjectives.

Pattern: `<measurable outcome> · verified by <test / metric / manual check>`

Example: `Profile page p95 load time ≤ 300ms (baseline 2s)` · verified by the new benchmark `profile_load_p95`.

If you cannot write the criterion, the goal is too vague. Rewrite the goal sentence first.

### 2. Non-goals
What this plan will not do. One line each. This stops scope creep.

### 3. Context and assumptions
Facts about the code today. One line each. Add file paths where they help.
Mark every guess with **(assumption)**.

### 4. Unknowns and questions
- **4a. Blocking**: you must resolve these before you start.
- **4b. Non-blocking**: you can resolve these during the work.

Never invent an answer.

### 5. Approach and alternatives
Describe the chosen approach in 2–4 sentences.
List 1–3 other options with a one-line trade-off each.
State each architectural decision and the reason for it.

### 6. Files to change (directory tree)
Draw a tree of only the files this plan touches.
Show enough folders to locate each file. Do not print the whole repository.

Tag every file with one label:

| Tag | Meaning |
|---|---|
| `[NEW]` | the file does not exist yet |
| `[EDIT]` | the file exists and you change it |
| `[DELETE]` | you delete the file — say what replaces it |
| `[MOVE]` | you move or rename the file — show the new path |

Write one short line per file. Say **what** changes, not how you code it.

```
src/
  data/
    cache/
      UserGraphCache.kt      [NEW]     in-memory cache, entries expire after 5 minutes
    repository/
      UserRepository.kt      [EDIT]    getGraph() reads the cache first, writes on refresh
  di/
    CacheModule.kt           [EDIT]    provide the cache as a singleton
test/
  data/cache/
    UserGraphCacheTest.kt    [NEW]     cover hit, miss, and expiry
```

Rules:
- List only files you really touch. An unlisted file is a promise you will not touch it.
- Keep the tree under 25 lines. Group the repeats: `+ 6 more vendor adapters, same one-line change`.
- Add a config, migration, or documentation file when the change needs it. Readers forget these.

### 7. Flow diagram (ASCII)
Draw one ASCII diagram of the flow **after** the change.
Show the steps in order. Show the data that moves between the steps.
Mark every new or changed part with `*`, and add the legend line.

```
  ProfileScreen
        |
        | getGraph(userId)
        v
  +----------------+   1. look up    +---------------------+
  | UserRepository |---------------->|  UserGraphCache  *  |
  +----------------+<----------------+---------------------+
        |               2. hit: return the cached graph
        | 3. miss
        v
  +----------------+
  | GraphApi (net) |
  +----------------+
        |
        | 4. store the response, then return  *
        +-------------------------------------> UserGraphCache  *

  * = new or changed by this plan
```

Pick the shape that fits the change:
- **Request path** — boxes and arrows from entry point to response.
- **Data pipeline** — stages left to right, with the artifact each stage produces.
- **State machine** — states in boxes, transitions on the arrows.
- **Sequence** — actors in columns, messages as horizontal arrows.

Rules:
- Keep the diagram under 80 characters wide, so it does not wrap in a terminal.
- Use plain ASCII: `+ - | v ^ < >`. Do not use Unicode box characters.
- Label every arrow with the data or the call it carries.
- Number the steps when the order is not obvious.
- Draw a second "before" diagram only when the change rewires an existing flow and words alone are unclear.

### 8. Step-by-step breakdown (test-first)
Write 3–10 ordered cycles. One cycle covers one behaviour.
Each cycle names its test file, its source file, and its done-criterion.
Load `test-driven-development` for the rules of the cycle itself.

| # | Red: write the failing test | Green: make it pass | Refactor | Done when |
|---|---|---|---|---|
| 1 | `UserGraphCacheTest.kt` — hit, miss, expiry | `data/cache/UserGraphCache.kt` | extract the clock behind an interface | the 3 cache tests pass |
| 2 | `UserRepositoryTest.kt` — read the cache before the network | `data/repository/UserRepository.kt` | — | the new test passes and the old ones stay green |
| 3 | `[NO-TEST]` wiring only | `di/CacheModule.kt` | — | the app starts and step 2 still passes |

Rules:
- Run the test and see it fail before you write the source. A test that passes on the first run does not test your change.
- One cycle changes one behaviour. Split the cycle when the Green column names more than one source file.
- Write `—` in the Refactor column when there is nothing to clean up. Do not invent work.
- End every cycle with a green suite. A later cycle may then build on the code of an earlier one.
- Mark a cycle `[NO-TEST]` when no test is possible: configuration, wiring, documentation, or a generated file. Give the reason in the same cell.
- Write a spike as its own cycle, and say you delete the spike code before the next cycle.
- The tests in the Red column are the same tests you list in §11a and §11b. Name them once here, then list them there.

### 9. Work sequencing
Group the cycles from §8 into **slices**. One slice is one self-contained unit of work with one owner.
Keep every cycle whole. Never split the Red and the Green of one cycle across two slices.

pi runs one implementation agent: this session. Slices are an ordering and ownership device, not a fan-out plan.

| Slice | Owns these files | Runs after | Deliverable |
|---|---|---|---|
| A: cache class | `data/cache/UserGraphCache.kt`, `test/data/cache/UserGraphCacheTest.kt` | — | the 3 cache tests pass |
| B: repository wiring | `data/repository/UserRepository.kt`, `di/CacheModule.kt` | A | the new repository test passes |
| C: benchmark | `benchmark/ProfileLoadBenchmark.kt` | — | the p95 number for §1a |

Rules:
- **One file has one owner.** Two slices must never write the same file.
- Order the slices so a later one never needs code an earlier one has not written yet.
- Write down the file list, the done-criterion, and a do-not-touch list for each slice. You lose context between sessions; the slice must survive that.
- Mark a slice **parallel-safe** only when its files do not overlap with any other slice and it does not import code another slice is still writing. That mark is information for the user, not a licence to spawn agents.
- Keep the synthesis in this session. Never delegate the understanding of the result.
- When the order is forced, write one line and the reason: `Serial: every step edits app.py.`

**Read-only help.** `pi --print "PROMPT"` runs a separate pi for context gathering or a code review.
Use it for reading and judging only. Never hand it an implementation slice.

**Worktrees.** Use plain `git worktree` when either case is true:
- The working tree is dirty and the new work must stay off those uncommitted changes.
- The user asks for isolation, or the change is risky enough to want a throwaway branch.

```bash
git worktree add .worktrees/<branch> -b <branch>   # add
cd .worktrees/<branch>                             # work, commit on the branch
git worktree remove .worktrees/<branch>            # clean up after the merge
```

Keep worktrees in the project-local `.worktrees/` directory and add it to `.gitignore`.
Commit on the worktree branch. The merge back to the base branch waits for the user's approval.
Never `rm -rf` a worktree — `git worktree remove` follows symlinks into the main repo.

### 10. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| The cache serves stale data after a profile edit | Medium | Clear the entry on the write path; add an integration test |

### 11. Validation plan
Fill every category below. If a category does not apply, write `SKIPPED` plus a one-line reason.
The tests in 11a and 11b come from the Red column of §8. Copy them here; do not invent new ones.

- **11a. Unit tests**: list the unit tests you add or change.
- **11b. Mocked integration tests**: list the integration flows you test with mocked external dependencies.
- **11c. Visual verification**: list the screens or outputs you check by eye, and name the tool for each. Examples: Playwright screenshots for web, an emulator or device for mobile, window screenshots for desktop UI, terminal capture for CLI/TUI.
- **11d. Metrics and logs**: list the metrics or logs you watch after the change lands. Load `create-proper-logging` when the change adds or changes log lines.

### 12. Rollout and reversibility
State the deploy strategy: feature flag, staged, or all at once.
State the rollback plan in one sentence.
State the migration order and its safety checks.

### 13. Out-of-scope follow-ups
List what you noticed and decided to defer. This becomes the input for the next plan.

## Estimation (use rarely)

Estimate only when the user asks, or when the scope is clearly at risk.
Give a range ("4–8 hours"), never a single number.
Name the largest source of variance.

## Quality bar

Do | Don't
---|---
Name files, symbols, and concrete outcomes ("move the token refresh from `AuthInterceptor` to `TokenRepository`") | Write abstract goals ("refactor auth"), or a plan with no file paths
Draw the file tree with a tag and a one-line change per file | Write "touch a few files in the auth module"
Draw one ASCII flow diagram and mark the new parts | Describe a 6-step flow in one long paragraph
Give each slice one owner per file, and order it after its dependencies | Let two slices write the same file, or ignore a slice that depends on another
Use `git worktree` when the tree is dirty and the work must stay off it | Fan out parallel agents on one shared checkout and hope for the best
Cite what you read in the codebase | Invent certainty, or hide the unknowns
Prefer small reversible steps with a done-criterion | Write giant steps, or "bugs might happen"-tier risks
Name the failing test before the source file in every cycle | Plan the code first and leave the tests for the end
Flag the decisions the user may want to change | Design for needs nobody asked for
Write one line for an obvious step, more for a hard one | Explain what the user already knows
Update the plan when reality is different | Write the plan, then ignore it
