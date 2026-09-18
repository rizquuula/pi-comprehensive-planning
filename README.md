# pi-comprehensive-planning

Implementation plans your agent has to actually write down — for the [pi coding agent](https://pi.dev).

Ask for a feature and most agents start editing files. This package makes the agent produce a
reviewable plan first: goal, testable success criteria, the exact files it will touch, an ASCII flow
diagram, test-first cycles, and the risks it is accepting. You read it in under three minutes and say
go, or change something.

```bash
pi install npm:pi-comprehensive-planning
```

Then just describe what you want. The skill triggers on "plan this", "design this", "break this down",
or automatically when the work spans 3+ files, a new module, an external integration, a schema
migration, or an architectural change. Say "just do it" to skip it.

## What's inside

Twenty skills. One of them writes plans; the rest are the standards the plan has to comply with, so
the design starts correct instead of getting corrected in review.

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

Planned for the extension half of this package:

- `/plan-comprehensively` — deterministic trigger instead of waiting for the model to decide
- `plan_validate` — mechanical check of a written plan (are the success criteria measurable, does the
  file tree carry `[NEW]`/`[EDIT]` tags, does every cycle have a failing test named)
- A todo list derived from the plan's own cycles, so the plan and the todos cannot drift apart

## Security

Skills are instructions to a model, and a model with tools can run anything. Read the files before
you install this, or anything else. There is no executable code in this package yet; when the
extension lands it will run with your full user permissions, and this section will say so plainly.

## Provenance

These skills were extracted from a personal Claude Code skills collection, then adapted for pi: the
parallel-subagent guidance became single-writer work sequencing, `/use-worktree` became plain
`git worktree`, and references to skills outside this package were removed. They follow the
[Agent Skills](https://agentskills.io/specification) standard, so other harnesses can read them too.

## License

MIT
