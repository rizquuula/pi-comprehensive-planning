# Rust Type Granularity & Project Layout

How to split types across modules, and the crate/workspace shape around them.

---

## Type & File Granularity

Rust is not class-per-file — but it is close to **type-per-module**. Cohesion lives in the module tree, not in a file that accumulates types.

**Do**
- **One primary type per module file**, with its `impl` blocks and its trait impls. `struct InvoiceService` lives in `invoice_service.rs` — the file name is the type name in snake_case, so the module tree is the type index
- Keep the type's associated errors, builder, and `impl Trait for Type` blocks in the same file — they are the type, not neighbours
- Prefer `foo.rs` + `foo/` over `foo/mod.rs`; `mod.rs` files are legal but every one of them is called `mod.rs` in your editor tabs and in `git log`
- Re-export the public surface with `pub use` in `lib.rs` (and in each `foo.rs`) so callers write `use myapp::billing::InvoiceService`, never the deep internal path
- Default every item to `pub(crate)`; `pub` is a semver commitment, so spend it deliberately. `pub(super)` and `pub(in crate::billing)` exist — use them instead of widening
- Turn a module into a directory when it crosses the module budget (`tooling-and-limits.md`) or grows a second primary type
- Turn a directory into its own workspace crate when it needs a different dependency set, a different feature matrix, its own compile-time boundary, or an independent release cadence
- Declare the module's public port (`trait InvoiceRepository`) in its own file and each adapter implementation in its own — one file per implementation

```
src/billing/
├── mod.rs is avoided; the parent declares `mod billing;` in billing.rs
```

```
src/
├── lib.rs                       # pub use billing::{Invoice, InvoiceService};
├── billing.rs                   # `pub mod invoice; pub use ...` — the slice's surface
└── billing/
    ├── invoice.rs               # struct Invoice + its impls
    ├── invoice_service.rs       # struct InvoiceService
    ├── invoice_repository.rs    # trait InvoiceRepository (the port)
    ├── postgres_invoice_repository.rs   # struct PostgresInvoiceRepository
    └── error.rs                 # enum BillingError (one error enum per slice)
```

The one narrow exemption: private helper types that are unusable outside their owner — an internal cursor, a state-machine state enum, a `struct` that exists only as a `HashMap` key — stay in the owner's file. They are implementation detail, not a second public type. Everything else moves.

No lint enforces this; it is a naming and review convention. The payoff is that `git log -- src/billing/invoice.rs` is exact, merges stop colliding across unrelated types, and finding a definition needs only the filename.

**Don't**
- `types.rs` / `models.rs` / `utils.rs` / `common.rs` holding a dozen unrelated types — that's a directory whose files were never split, and it becomes the module every other module depends on
- `pub` on everything "so tests can reach it" — unit tests live inside the module (`testing.md`) and already see private items
- A `mod.rs` containing real logic — `mod.rs` (or `foo.rs`) declares submodules and re-exports; behaviour belongs in a named file
- Split one type's `impl` across two files to duck the module budget — a type too big for one file is two types
- Glob re-exports (`pub use inner::*`) in a public crate root — they leak internals and make semver breakage invisible
- A directory that will only ever hold one file — collapse it next to its siblings
- Reaching for a new workspace crate to organise code; crates are compile-time and dependency boundaries, not folders

---

## Project Layout

**Do**
- `src/lib.rs` for the library root, `src/main.rs` for the binary; extra binaries in `src/bin/*.rs`
- Ship logic in the library and keep `main.rs` to argument parsing plus wiring — otherwise nothing in the binary is testable or reusable
- Integration tests in `tests/` (each file compiles as its own crate), benchmarks in `benches/`, runnable samples in `examples/`
- Define the public API in `lib.rs` with explicit `pub use`; keep internals private (Type & File Granularity above)
- `rust-toolchain.toml` to pin the channel; `.cargo/config.toml` for shared rustflags, aliases, and target config
- `build.rs` only for genuine build-time needs (codegen, linking native libs, embedding a git hash) — it runs on every consumer's machine
- Additive, self-describing feature flags (`postgres`, `tls`) with `default = []` where possible; document each in the crate docs

**Small library** — the floor; don't build more structure than this until it hurts:

```
my_crate/
├── Cargo.toml               # deps, features, [lints] — single source
├── rustfmt.toml             # max_width and friends (`tooling-and-limits.md`)
├── clippy.toml              # complexity thresholds (`tooling-and-limits.md`)
├── README.md
├── src/
│   ├── lib.rs               # crate root: pub use re-exports only
│   ├── parser.rs            # module `parser` + its public surface
│   ├── parser/
│   │   ├── lexer.rs         # struct Lexer
│   │   └── token.rs         # enum Token
│   └── error.rs             # enum ParseError (thiserror)
├── tests/
│   └── parse_roundtrip.rs   # own crate: sees only the public API
├── benches/
│   └── parse.rs             # criterion
└── examples/
    └── parse_file.rs        # cargo run --example parse_file
```

**Application / workspace** — crate boundaries doing the architectural work:

```
myapp/
├── Cargo.toml                    # [workspace] members + [workspace.dependencies]
├── Cargo.lock                    # committed: this workspace produces binaries
├── rust-toolchain.toml           # channel = "1.83.0" — CI and laptops agree
├── clippy.toml
├── rustfmt.toml
├── deny.toml                     # cargo-deny: licences, advisories, duplicate deps
├── .cargo/
│   └── config.toml               # rustflags, aliases, cross-compile targets
├── migrations/                   # sqlx/refinery; never edit an applied migration
├── crates/
│   ├── domain/                   # pure business logic
│   │   ├── Cargo.toml            # deps: serde, thiserror, time — no tokio, no sqlx
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── money.rs          # struct Money (newtype)
│   │       ├── invoice.rs        # struct Invoice
│   │       ├── invoice_repository.rs   # trait InvoiceRepository (port)
│   │       └── error.rs          # enum DomainError
│   ├── storage-postgres/         # outbound adapter
│   │   ├── Cargo.toml            # deps: myapp-domain, sqlx, tokio
│   │   └── src/
│   │       ├── lib.rs
│   │       └── postgres_invoice_repository.rs   # impl InvoiceRepository
│   ├── http-api/                 # inbound adapter
│   │   ├── Cargo.toml            # deps: myapp-domain, axum
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── router.rs
│   │       └── routes/
│   │           ├── invoices.rs   # parse → delegate → serialize; no logic
│   │           └── health.rs
│   └── app/                      # the binary: wiring only
│       ├── Cargo.toml            # deps: every crate above
│       ├── build.rs              # embeds git SHA into a const
│       └── src/
│           ├── main.rs           # parse args, build config, construct, serve
│           ├── config.rs         # env → typed Config, loaded once
│           └── bin/
│               └── migrate.rs    # second binary: cargo run --bin migrate
└── tests/                        # workspace-level end-to-end, if any
```

```toml
# myapp/Cargo.toml
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.package]
edition = "2021"
rust-version = "1.83"

[workspace.dependencies]           # one version per dep, members write `workspace = true`
tokio  = { version = "1", features = ["rt-multi-thread", "macros"] }
serde  = { version = "1", features = ["derive"] }
myapp-domain = { path = "crates/domain" }

[workspace.lints.clippy]
too_many_lines = "warn"
```

```toml
# crates/domain/Cargo.toml
[dependencies]
serde = { workspace = true }

[features]
default = []
serde = ["dep:serde"]              # additive; never a feature that removes API

[lints]
workspace = true
```

Dependencies point inward: `http-api` and `storage-postgres` depend on `domain`; `domain` depends on neither, and `app` wires them at `main.rs`. In a workspace the compiler enforces this for free — a cycle simply will not build, and a domain crate whose `Cargo.toml` lists no adapter cannot accidentally import one. Keep it honest with `cargo deny check bans` (no surprise transitive additions) and `cargo machete` (dependencies nothing imports are usually a boundary violation that got reverted halfway).

Go multi-crate when: a boundary needs enforcing, compile times hurt and the graph can parallelise, part of the tree ships separately, or feature flags are pulling one crate in two directions. Not before — a single crate with disciplined modules (Type & File Granularity above) is cheaper to move around.

**Don't**
- Dump everything into `main.rs` / `lib.rs` — split into modules early
- A binary crate with no library — the logic then can't be integration-tested from `tests/`
- A `utils` or `common` crate — it becomes the node every crate depends on and nothing can be extracted again
- Feature flags that change behaviour rather than add it — features are unioned across the dep graph, so a subtractive feature breaks unrelated consumers
- `[patch]` or `path` dependencies pointing outside the workspace in committed manifests
- Reading environment variables outside `config.rs` — scattered `std::env::var` is untestable
- Business logic inside `routes/` handlers, or SQL inside `domain/`
