# Rust Tooling, Size & Complexity Limits

Clippy, rustfmt, and cargo configuration, plus the size/complexity budgets they enforce.

---

## Tooling

**Do**
- Run `cargo clippy --all-targets --all-features -- -D warnings` in CI; treat lints as errors
- Enforce `rustfmt` in CI (`cargo fmt --check`)
- Use `cargo deny check` / `cargo audit` for dependency vulnerability and licence scanning
- Use `cargo machete` (or `cargo udeps`) to find dependencies nothing imports
- Commit `Cargo.lock` for binaries; gitignore it for libraries
- Scope feature flags carefully; build `--no-default-features` and `--all-features` in CI
- Pin the toolchain in `rust-toolchain.toml` so CI and dev machines agree

**Don't**
- Ignore `clippy` warnings with blanket `#[allow(clippy::all)]`
- Skip `Cargo.lock` for binaries (reproducibility matters)
- Put lint config in shell flags only — it belongs in `[lints]` / `clippy.toml` where it is reviewable

```toml
# .cargo/config.toml — treat warnings as errors for every cargo invocation
[target.'cfg(all())']
rustflags = ["-D", "warnings"]
```

Extend the lint set with the size and complexity lints in the Size & Complexity Limits section below to make the budgets enforceable.

---

## Size & Complexity Limits

Budgets, not gates — cross one and look for the seam, don't split mechanically at the boundary.

| Unit | Target | Pause | Refactor |
|---|---|---|---|
| Line length | ≤ 100 chars (rustfmt `max_width` default) | — | hard cap — let the formatter wrap |
| Function / method | ≤ 30 lines | 50 | 100 — `too_many_lines` default; extract |
| `impl` block | ≤ 200 lines | 300 | 400 — split into several `impl`s or a trait |
| Struct / enum | ≤ 12 fields / variants | 15 | 20 — a sub-struct or sub-enum is hiding there |
| Module (`.rs`) | 100–400 lines | 500 | 700 — promote `foo.rs` to `foo.rs` + `foo/` |
| Parameters | ≤ 4 | 5 | 7 — `too_many_arguments` default; pass a config struct |
| Nesting depth | ≤ 3 | 4 | guard-clause / `?` it back down |
| Cognitive complexity | ≤ 15 | 20 | 25 — split branches into named helpers |
| Type complexity | plain named types | — | `type_complexity` fires — introduce a type alias or newtype |
| Generic params per item | ≤ 2 | 3 | 4 — bundle bounds into one trait, or take a struct |
| Trait methods | ≤ 6 | 8 | 10 — segregate into role traits |

**Do**
- Enforce it in the crate so the numbers aren't folklore. Thresholds live in `clippy.toml` at the workspace root:

```toml
# clippy.toml
too-many-arguments-threshold = 5
too-many-lines-threshold = 60
cognitive-complexity-threshold = 20
type-complexity-threshold = 250
excessive-nesting-threshold = 4
```

```toml
# Cargo.toml (Rust 1.74+); in a workspace put this under [workspace.lints]
# and add `[lints] workspace = true` to each member crate.
[lints.rust]
unsafe_code = "deny"          # remove per-crate where unsafe is genuinely needed

[lints.clippy]
too_many_arguments = "warn"   # style group, on by default — raised to a hard signal here
type_complexity    = "warn"   # complexity group, on by default
too_many_lines     = "warn"   # pedantic — off by default, must be opted into
cognitive_complexity = "warn" # nursery — off by default, opt in
excessive_nesting  = "warn"   # restriction — off by default, opt in
```

- Know which groups need opting in: `too_many_arguments` and `type_complexity` are on by default; `too_many_lines` is **pedantic**, `cognitive_complexity` is **nursery**, `excessive_nesting` is **restriction** — none of the three fire unless you enable them. Nursery lints can be noisy and may change between releases; pin the toolchain (Tooling section above) so CI doesn't shift under you.
- Set widths in `rustfmt.toml` rather than arguing them in review:

```toml
# rustfmt.toml
max_width = 100          # stable
use_small_heuristics = "Default"   # stable: derives fn_call_width, struct_lit_width, etc.
# fn_call_width = 60     # nightly-only; use_small_heuristics covers it on stable
```

- Split a module the moment it crosses the budget: `parser.rs` → `parser.rs` + `parser/{lexer.rs,token.rs}` — importers keep working because `parser.rs` still declares `mod lexer;`
- Count *logical* lines — a long `match` over 30 enum variants, a generated table, or `#[cfg(test)]` fixtures is not complexity
- Add `#[allow(clippy::too_many_lines)]` with a one-line reason on the rare genuine exception (a hand-written parser dispatch table), never crate-wide

**Don't**
- Blanket `#![allow(clippy::cognitive_complexity)]` at crate root to make CI green
- Keep a 200-line `fn main()` because "it's just wiring" — wiring extracts into named `build_*` functions cleanly
- Split a coherent module into `helpers.rs` + `misc.rs` just to get under a line count
- Count the `impl` block's doc comments and `#[derive]`s against its budget
- Chase a low `type_complexity` score with `type T = ...` aliases that hide meaning — prefer a newtype that carries a name

### Getting back under budget

Complexity is branches × nesting. Work down this list in order — the first four fix most violations.

**1. `?` instead of nested matching.** Rust's error plumbing is the single biggest source of accidental depth.

```rust
// depth 4
fn load(path: &Path) -> Result<Config, Error> {
    match fs::read_to_string(path) {
        Ok(text) => match toml::from_str(&text) {
            Ok(cfg) => match validate(&cfg) {
                Ok(()) => Ok(cfg),
                Err(e) => Err(Error::Invalid(e)),
            },
            Err(e) => Err(Error::Parse(e)),
        },
        Err(e) => Err(Error::Io(e)),
    }
}

// depth 1
fn load(path: &Path) -> Result<Config, Error> {
    let text = fs::read_to_string(path)?;
    let cfg: Config = toml::from_str(&text)?;
    validate(&cfg)?;
    Ok(cfg)
}
```

**2. `let ... else` for guard clauses.** Binds on the happy path and diverges on the sad one, so the rest of the function is unindented.

```rust
// pyramid
fn charge(order: Option<&Order>) -> Option<Receipt> {
    if let Some(order) = order {
        if !order.items.is_empty() {
            if order.customer.is_active() {
                return Some(gateway::charge(order.total()));
            }
        }
    }
    None
}

// flat
fn charge(order: Option<&Order>) -> Option<Receipt> {
    let Some(order) = order else { return None };
    if order.items.is_empty() || !order.customer.is_active() {
        return None;
    }
    Some(gateway::charge(order.total()))
}
```

**3. One `match` over a chain of nested `if let`.** Matching the tuple or the enum directly gets exhaustiveness checking back, which the `if let` chain silently gave up.

```rust
// over
if let Some(a) = left {
    if let Some(b) = right {
        combine(a, b)
    } else {
        a.clone()
    }
} else { ... }

// prefer
match (left, right) {
    (Some(a), Some(b)) => combine(a, b),
    (Some(a), None) => a.clone(),
    (None, Some(b)) => b.clone(),
    (None, None) => Value::default(),
}
```

**4. Extract a named helper per step.** A comment explaining a block is that block's future function name. Free in Rust: a private `fn` in the same module costs nothing at runtime and gets its own `#[cfg(test)]` test.

**5. Config struct or builder past ~5 params.** Parameters that always travel together are one missing concept, and the struct is where validation lands — deleting guards from every caller.

```rust
// over: 7 positional params, callers swap two bools and it still compiles
pub fn connect(host: &str, port: u16, tls: bool, retries: u8,
               timeout: Duration, pool: usize, verify: bool) -> Result<Client, Error>

// prefer
#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub host: String,
    pub port: u16,
    pub tls: TlsMode,          // not a bool
    pub retries: u8,
    pub timeout: Duration,
    pub pool_size: usize,
}

impl ClientConfig {
    pub fn builder(host: impl Into<String>) -> ClientConfigBuilder { /* ... */ }
}

pub fn connect(cfg: &ClientConfig) -> Result<Client, Error> { /* ... */ }
```

**6. Newtypes instead of primitive param soup.** `fn transfer(from: u64, to: u64, amount: i64)` has three swappable arguments; `fn transfer(from: AccountId, to: AccountId, amount: Money)` has one, and the compiler catches the swap.

**7. Enum or trait object where the same `match kind` appears in more than two functions.** That string or discriminant is a type wearing a disguise.

```rust
// over: the same 8-arm match repeated in fee(), label(), settles_in()
fn fee(kind: &str, amount: Money) -> Money {
    match kind {
        "wire" => amount * dec!(0.03),
        "ach" => amount * dec!(0.01),
        // 6 more, in three different functions
        _ => panic!("unknown"),
    }
}

// prefer: one type, dispatch disappears, new kinds are a variant not an edit everywhere
pub trait Rail {
    fn fee(&self, amount: Money) -> Money;
    fn settles_in(&self) -> Duration;
}

pub struct Wire;
impl Rail for Wire {
    fn fee(&self, amount: Money) -> Money { amount * dec!(0.03) }
    fn settles_in(&self) -> Duration { Duration::from_secs(60 * 60) }
}
```

Use an `enum` when the set is closed and you want exhaustiveness; `Box<dyn Rail>` when callers extend it.

**8. Iterator chains instead of manual loops with `continue`.** Filter/map/fold loops collapse into one expression, and `collect::<Result<Vec<_>, _>>()` handles the fallible case without a mutable accumulator.

```rust
// over
let mut out = Vec::new();
for row in rows {
    if row.deleted { continue; }
    let parsed = match parse(&row.body) { Ok(p) => p, Err(e) => return Err(e) };
    if parsed.score > 0 { out.push(parsed); }
}

// prefer
let out: Vec<_> = rows
    .iter()
    .filter(|r| !r.deleted)
    .map(|r| parse(&r.body))
    .collect::<Result<Vec<_>, _>>()?
    .into_iter()
    .filter(|p| p.score > 0)
    .collect();
```

**9. Split a fat `impl` across several `impl` blocks or a trait.** A 600-line `impl Order` is legal and unreadable; group by role — `impl Order` for constructors and accessors, `impl Pricing for Order`, `impl Serialize for Order` — and each block can move to its own file (`project-layout.md`) later without touching callers.

**10. Macros and attributes for cross-cutting boilerplate.** Retry, tracing spans, metrics and error conversion are not the function's logic: `#[tracing::instrument]`, `#[derive(thiserror::Error)]` with `#[from]`, and `impl From<X> for MyError` take whole branch clusters with them. Reach for `macro_rules!` only after the third hand-written repetition — a macro is harder to read than the code it replaced.

**Don't** trade complexity for indirection: five one-line helpers called once each, in order, is the same function with extra jumps. Extract when the piece has a name, a boundary, and ideally its own test — not to satisfy the linter.
