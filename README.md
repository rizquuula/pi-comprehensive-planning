# pi-comprehensive-planning

Implementation plans your agent has to actually write down — for the [pi coding agent](https://pi.dev).

Ask for a feature and most agents start editing files. This package makes the agent produce a
reviewable plan first: goal, testable success criteria, the exact files it will touch, an ASCII flow
diagram, test-first cycles, and the risks it is accepting. You read it in under three minutes and say
go, or change something.

```bash
pi install npm:pi-comprehensive-planning
```

Then just describe what you want, or run the command:

```
/plan-comprehensively add a GET /health endpoint that reports database connectivity
```

The skill triggers on "plan this", "design this", "break this down", or automatically when the work
spans 3+ files, a new module, an external integration, a schema migration, or an architectural
change. Say "just do it" to skip it. The command is the deterministic version of the same thing — it
does not wait for the model to decide a plan is warranted.

## The extension

The skills carry the judgement. The extension adds the three things prose cannot.

**`/plan-comprehensively <task>`** — loads the skill, tells the model to write `PLAN.md` section by
section, and names the session after the task. If you run it with no argument, it asks what to plan.

**`plan_validate`** — a tool the model calls on the written plan. It checks the mechanical rules:
are the success criteria measurable and tied to a test or metric, does the file tree carry
`[NEW]`/`[EDIT]`/`[DELETE]`/`[MOVE]` tags, is there a real ASCII diagram, does every cycle name a
failing test and a done-criterion, does any file get claimed by two slices, is every validation
category filled or explicitly `SKIPPED`. Errors and warnings are reported separately.

```
PLAN.md: 2 error(s), 1 warning(s).

ERROR §8    Cycle 1: the Red column is empty. Name the failing test first.
ERROR §9    src/auth/token.ts is claimed by 2 slices (A, B). One file, one owner.
warn  §8    Only 2 cycle(s). Anything non-trivial usually needs 3–10.
```

**A todo list that cannot drift** — the §8 cycles are already an ordered checklist, so the extension
renders them under the editor instead of keeping a second copy of the truth. Edit the plan and the
todos change with it.

**One nudge, once** — if three or more files get edited in a session with no `PLAN.md` anywhere, pi
says so. It never blocks anything, and it stays quiet after that.

## What's inside

Twenty skills and one extension. One skill writes plans; the rest are the standards the plan has to
comply with, so the design starts correct instead of getting corrected in review.

**Planning**

| Skill | What it does |
|---|---|
| `comprehensive-planning` | The plan template and the rules for filling it in |
| `review-router` | Picks which standards apply to the language and the change |
| `quick-review` | Fast read-only pass over a diff before you push |

**Cross-cutting**

| Skill | What it does |
|---|---|
| `clean-code-standard` | Naming, structure, function shape, error handling |
| `test-driven-development` | Red → green → refactor, and when not to |
| `secure-coding` | Input boundaries, auth, secrets, injection |
| `solid-principle` | Where to split a type or a module, and why |
| `domain-driven-design` | Aggregates, boundaries, layering |
| `api-contract-design` | REST/gRPC surface, versioning, pagination, errors |
| `database-and-migrations` | Schema changes, migration order, safety checks |
| `clean-ui-standard` | Components, a11y, design tokens, states, motion |
| `create-proper-logging` | Structured logs, levels, correlation IDs, redaction |
| `design-for-growth` | Opt-in only. Architectural seams for long-lived projects |

**Languages** — each with `references/` for tooling, testing, and project layout

`python-best-practices` · `golang-best-practices` · `rust-best-practices` · `cpp-best-practices` ·
`kotlin-best-practices` · `flutter-best-practices` · `hexagonal-architecture-go`

## Context cost, and how to cut it

Skill *descriptions* are always in the system prompt. Bodies are not — they load on demand. That is
20 descriptions ≈ **13 KB ≈ 3.4 K tokens**, paid on every request whether or not you plan anything.

If you only want the planning core, filter the language skills out in `settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:pi-comprehensive-planning",
      "skills": ["skills/*", "!skills/*-best-practices"]
    }
  ]
}
```

That drops the six `-best-practices` skills and lands around 2 K tokens. Run `pi config` to toggle
any remaining skill on or off interactively — that is the reliable way to drop a single skill such as
`hexagonal-architecture-go`.

## Roadmap

- A `plan_validate` summary rendered as a diff against the previous validation, so you can see what
a revision fixed
- Deriving §11 from §8 instead of asking for it twice
- A `--report` flag on `/plan-comprehensively` that writes the plan to a path of your choosing

## Development

There is no build step. pi loads the TypeScript directly, so a clone runs as-is:

```bash
pi -e ./ --no-skills          # load this package in isolation
npm test                      # node --test, no dependencies installed
```

The tests cover the validator only — the part with rules worth pinning down. `tests/plan-file.test.ts`
builds one plan that must produce zero findings, then breaks it eleven different ways.

## Security

Skills are instructions to a model, and a model with tools can run anything. The extension here reads
and writes files, registers one tool, one command, and two event handlers. It runs no subprocesses,
opens no sockets, and makes no network calls of its own. Read the source before you install it — it is
about 450 lines.

## Provenance

These skills were extracted from a personal Claude Code skills collection, then adapted for pi: the
parallel-subagent guidance became single-writer work sequencing, `/use-worktree` became plain
`git worktree`, and references to skills outside this package were removed. They follow the
[Agent Skills](https://agentskills.io/specification) standard, so other harnesses can read them too.

## License

MIT
