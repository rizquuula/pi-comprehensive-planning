# pi-comprehensive-planning — build plan

Goal: publish `pi-comprehensive-planning` to npm so anyone can
`pi install npm:pi-comprehensive-planning`. Package ships skills **and** an extension.

- [x] 1. Clean the 20 bundled skills for public use (remove author-specific and host-specific text)
- [x] 2. Scaffold the package (`package.json` with `pi.skills`, README, LICENSE, .gitignore)
- [x] 3. Verify the package loads — `pi -e . --no-skills` → exactly 20 skills
- [x] 4. Write the extension half
- [ ] 5. Publish to npm, then `pi install npm:pi-comprehensive-planning`
- [ ] 6. Push to GitHub, tag the release
- [ ] 7. Swap the local-path install in `~/.pi/agent/settings.json` for the npm one after publishing

## Next: publish

```bash
cd /Users/rizquuula/Playground/pi/pi-comprehensive-planning
git remote add origin git@github.com:rizquuula/pi-comprehensive-planning.git
git push -u origin main
npm publish
```

`pi-comprehensive-planning` was free on npm when this was checked (2026-09-18).
`pi-plan`, `pi-planning`, and `pi-todo` are taken by other people.

After publishing, replace the local path in `~/.pi/agent/settings.json`:

```bash
pi remove /Users/rizquuula/Playground/pi/pi-comprehensive-planning
pi install npm:pi-comprehensive-planning
```

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
- `--print` **dispatches extension commands** (verified), but silently drops any turn the handler
  injects with `sendUserMessage`. Test commands through the SDK instead: `session.prompt(cmd)`
  resolves as soon as the command dispatch finishes, so wait for the agent to go idle before
  checking the result.
- The SDK needs both `cwd` and `agentDir` on `DefaultResourceLoader`, or it throws on `resolvePath`.
  Pass `skillsOverride: () => ({ skills: [], diagnostics: [] })` to isolate from global skills.
- End-to-end proof of `/plan-comprehensively` (2026-09-18): injected the skill, the model wrote a
  13-section PLAN.md, called `plan_validate`, edited, and re-validated. Result: 0 errors, 1 warning
  ("Goal runs long"), and `planTodos` extracted 4 cycles for the widget.
- Not verified end-to-end: the 3-file nudge. It only fires when `ctx.hasUI` is true, so a headless
  run cannot observe it. Logic is 8 lines and guarded; test it interactively once.
