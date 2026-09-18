# pi-comprehensive-planning — build plan

Goal: publish `pi-comprehensive-planning` to npm so anyone can
`pi install npm:pi-comprehensive-planning`. Package ships skills **and** an extension.

- [x] 1. Clean the 20 bundled skills for public use (remove author-specific and host-specific text)
- [x] 2. Scaffold the package (`package.json` with `pi.skills`, README, LICENSE, .gitignore)
- [x] 3. Verify the package loads — `pi -e . --no-skills` → exactly 20 skills
- [ ] 4. Write the extension half
- [ ] 5. Publish to npm, then `pi install npm:pi-comprehensive-planning`
- [ ] 6. Push to GitHub, tag the release

## Next: the extension

Command name is decided: **`/plan-comprehensively`**.

Planned surface:

| Piece | What it does |
|---|---|
| `/plan-comprehensively <task>` | Deterministic trigger. Loads the skill, starts the workflow, no waiting for the model to decide |
| `plan_validate` tool | Mechanical checks on a written plan: measurable §1a criteria, §6 tree with `[NEW]`/`[EDIT]` tags, §7 ASCII diagram present, §8 cycles each naming a failing test, §9 one owner per file |
| todo widget | Derived from PLAN.md §8 cycles + §9 slices, so plan and todos cannot drift |
| `tool_call` hook | Warn (never block) when `edit`/`write` starts on a multi-file change with no PLAN.md |

Keep it zero-dependency. `@earendil-works/pi-coding-agent`, `typebox`, and `@earendil-works/pi-tui`
go in `peerDependencies` with `"*"` and must not be bundled.

## Verified facts (don't re-derive)

- `pi -e <dir>` loads package skills even with `--no-skills`. `--no-skills` alone also suppresses
  package skills that come from `settings.json` packages.
- `pi install -l <path>` writes a path **relative to `.pi/`** (so `./pkg2` becomes `../pkg2`).
  Hand-writing a relative path in `settings.json` must account for that.
- Package filter, verified by dumping the real system prompt:
  - `["skills/*"]` → all 20
  - `["!skills/*-best-practices"]` → 14 (six language skills dropped)
  - `["skills/*", "!skills/*-best-practices"]` → 14
  - `[]` → 0 (empty array disables the whole resource type)
- **Unresolved:** exact-name excludes did nothing in testing — `!skills/hexagonal-architecture-go`,
  `!skills/hexagonal*`, and `!hexagonal-architecture-go` all left the skill enabled. Only patterns
  ending in `*-best-practices` excluded anything. The bundle is minified
  (`dist/bundle/chunks/`), so `dist/core/package-manager.js` is *not* the code that runs.
  Worth an upstream issue; README documents only the verified pattern.
- Model self-reporting of its own skill list is unreliable. Twice it listed skills that were not
  loaded. Verify with `ctx.getSystemPrompt()` from a throwaway extension, not by asking the model.
