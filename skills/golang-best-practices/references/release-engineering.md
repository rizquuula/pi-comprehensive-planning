# Go Release, Obfuscation & Self-Update

Shipping distributed binaries: obfuscation, version embedding, self-update.

---

## Release, Obfuscation & Self-Update

Applies to distributed binaries (CLIs, desktop apps, agents shipped to end users) — not to services deployed on infrastructure you control.

### Obfuscated release builds

**Do**
- Build release executables with [`garble`](https://github.com/burrowers/garble): `garble -literals -tiny build -ldflags="-s -w" ./cmd/app`
- Always strip symbols and DWARF in releases: `-ldflags="-s -w"`, plus `-trimpath` to remove local paths
- Pin the garble seed (`GARBLE_SEED` / `-seed`) per release and record it, so panics from the field can be de-obfuscated
- Keep an unobfuscated build target for local debugging — obfuscated stack traces are useless without the seed

**Don't**
- Treat obfuscation as security — never embed secrets, API keys, or license logic you can't afford to lose in the binary; obfuscation only raises the reversing cost
- Obfuscate CI/test builds — only the release artifact
- Forget that garble breaks `runtime.Caller`-based tricks and some reflection; smoke-test the obfuscated binary, not just the plain one

### Version embedding & update check

**Do**
- Embed the version at build time: `-ldflags "-X main.version=v1.4.2"`; never hardcode it in source
- Check for updates against a release source — GitHub Releases API (`/repos/{owner}/{repo}/releases/latest`) or a self-hosted JSON manifest — comparing semver against the embedded version
- Make the check non-blocking and rate-limited (once per day / on-demand `app update`), with a short timeout; the app must work fully offline
- Verify what you download before applying: compare the release's published SHA-256 checksum, or verify a signature (e.g. minisign/cosign) for anything security-sensitive
- Use a maintained library instead of hand-rolling: `creativeprojects/go-selfupdate` (multi-source: GitHub/GitLab/Gitea) or `minio/selfupdate` (apply + rollback primitives)

**Don't**
- Auto-download in the request/startup hot path — a dead GitHub API must never delay launch
- Apply an update without checksum/signature verification — an unsigned swap is a supply-chain hole
- Assume the binary can overwrite itself in place — Windows locks a running exe

### Launcher + main app binary pattern

Updating must never kill the running main process mid-flight. Ship **two** binaries: a thin launcher (rarely updated) and the main app (frequently updated).

```
install-dir/
├── launcher(.exe)        # stable: spawn, watch, swap
└── versions/
    ├── app-v1.4.1(.exe)
    └── app-v1.4.2(.exe)  # downloaded + verified by updater
```

**Do**
- Launcher's only jobs: pick the current app version, spawn it as a child process, wait on exit, and swap versions between runs
- Download the new binary to a temp/staging path, verify it, then atomically rename into place — never write over the running file
- Let the *app* finish its work and exit gracefully with a sentinel exit code (e.g. `exit 3` = "update staged, relaunch me"); the launcher sees the code, swaps, and respawns
- On Windows, rename the old exe aside (`app.exe` → `app.old.exe`) before moving the new one in; delete the leftover on next start
- Keep the previous version on disk for one release as an automatic rollback if the new binary fails its first health check
- Keep the launcher dependency-free and boring — a launcher that needs updating defeats the pattern

**Don't**
- Have the app re-exec or overwrite itself while it still owns open files, sockets, or in-flight work
- Kill the child from the launcher to force an update — signal it (context cancel / SIGTERM handler) and let it drain
- Auto-update without an escape hatch — always support `--no-update` / pinned-version config for broken-release recovery
