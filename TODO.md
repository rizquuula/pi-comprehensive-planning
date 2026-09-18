# pi-comprehensive-planning — build plan

Goal: publish `pi-comprehensive-planning` to npm so anyone can
`pi install npm:pi-comprehensive-planning`. Package ships skills **and** an extension.

- [x] 1. Clean the 20 bundled skills for public use (remove author-specific and host-specific text)
- [x] 2. Scaffold the package (`package.json` with `pi.skills`, README, LICENSE, .gitignore)
- [x] 3. Verify the package loads — `pi -e . --no-skills` → exactly 20 skills
- [x] 4. Write the extension half
- [x] 5. Push to GitHub (public), tag `v0.2.0`
- [x] 6. Install from the GitHub URL and verify
- [x] 7. Publish to npm — live at https://www.npmjs.com/package/pi-comprehensive-planning

## Releasing a new version

```bash
npm version patch            # or minor / major
git push --follow-tags
npm publish
```

Publishing needs a granular access token with **Bypass 2FA** enabled, Permissions
**Read and write**, and Packages **All packages**. A token without bypass-2FA authenticates fine
(`npm whoami` succeeds) but every `npm publish` fails with a 403 about 2FA — that combination is the
tell. Keep the token in `~/.npmrc`; do not commit it.

`pi-plan`, `pi-planning`, and `pi-todo` are taken by other people on npm. This name was free.

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
- A local-path install and a git install of the same package **conflict**: pi sees them as different
  identities, loads both, and refuses the duplicate `plan_validate` tool with a hint to use `pi -ne`.
  Uninstall one before installing the other.
- A git install runs a plain `npm install` in the clone, which auto-installs `peerDependencies`.
  With `"*"` ranges that pulled the whole pi tree (166 packages) into a 450-line extension's
  `node_modules`. `peerDependenciesMeta: { optional: true }` fixes it — now it pulls nothing.
  npm also writes a `package-lock.json` into the clone, hence the .gitignore entry.
- `pi -e <source> --no-skills -ne` is the way to test a package in isolation. `-ne` is needed when the
  same package is already installed globally, or the duplicate tool registration aborts the run.
