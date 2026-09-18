---
name: rust-best-practices
description: Apply when writing, reviewing, or planning Rust code (.rs files). Covers ownership/borrowing, lifetimes, traits, iterators, newtypes, Option/Result, thiserror/anyhow, avoiding unwrap in libraries, integer overflow, unsafe, async blocking, Send/Sync, tokio, Arc Mutex, clippy/rustfmt, size and complexity budgets (too_many_lines, too_many_arguments, cognitive_complexity, type_complexity, excessive_nesting, clippy.toml, rustfmt max_width), type and file granularity (one type per module, mod.rs vs foo.rs, pub use re-exports, visibility), project layout (lib.rs, src/bin, benches, examples, build.rs, workspaces, feature flags, cargo-deny), and testing (cfg(test), tests/, rstest, proptest, insta, criterion, nextest, miri, doctests, llvm-cov). Use when the user mentions Rust, ownership, lifetimes, clippy, cargo, tokio, module layout, workspace, or project structure.
---

# Rust Best Practices

Opinionated defaults for correct, idiomatic Rust — name the tradeoff when you skip one.

---

## 1. Ownership & Borrowing

**Do**
- Borrow over clone; clone only at explicit ownership boundaries
- Accept `&str` / `&[T]` in params, return `String` / `Vec<T>` when ownership is needed
- Let the borrow checker guide design — fighting it signals a structural problem
- Use `Cow<'_, str>` (or `Cow<'_, [T]>`) when a value is sometimes owned, sometimes borrowed
- Restructure data to eliminate lifetime complexity before reaching for explicit annotations

**Don't**
- `.clone()` to silence the borrow checker without understanding why
- Store references in structs unless lifetimes are genuinely simpler than owned data
- Fight lifetimes with `'static` bounds or `Arc` as a first reflex

```rust
// prefer
fn greet(name: &str) -> String { format!("Hello, {name}") }
// over
fn greet(name: String) -> String { format!("Hello, {name}") }
```

---

## 2. Types & Idioms

**Do**
- Newtype pattern for domain types and units: `struct Meters(f64);` prevents mixing up values
- Use iterators + combinators (`map`, `filter`, `flat_map`, `fold`) over index loops
- Derive `Debug`, `Clone`, `PartialEq` (and `Eq`, `Hash` where applicable) routinely
- Use exhaustive `match`; avoid catch-all `_` that silently hides new variants
- Implement `From` / `TryFrom` for conversions; get `.into()` for free
- Builder pattern for structs with many optional fields
- Encode invariants in the type system — make impossible states unrepresentable with enums

**Don't**
- Use primitive types for domain values (`u32` for user IDs, `f64` for meters — wrap them)
- Index loops when an iterator chain is clearer
- Rely on `_` match arms in library code where new variants would silently be swallowed

```rust
// exhaustive enum prevents forgetting a case
match event {
    Event::Created(id) => handle_created(id),
    Event::Deleted(id) => handle_deleted(id),
    // no _ => {} here
}

// iterator over index loop
let doubled: Vec<_> = values.iter().map(|v| v * 2).collect();
```

---

## 3. Error Handling

**Do**
- Return `Result` everywhere errors can occur; never panic in library code
- Use `?` to propagate; add context with `.map_err(|e| MyError::context(e))` or `anyhow::Context`
- `thiserror::Error` for typed, structured errors in libraries
- `anyhow::Error` (or `eyre::Report`) for application-level error propagation
- `unwrap()` / `expect("reason")` only in tests, `main`, or genuinely infallible paths — always add a message to `expect`

**Don't**
- `unwrap()` in library code or any non-test production path
- Stringly-typed errors (`Box<dyn Error>` with string messages in libraries)
- Swallow errors with `let _ = risky_call()`

```rust
// library
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("invalid header: {0}")]
    InvalidHeader(String),
}

// application
fn run() -> anyhow::Result<()> {
    let cfg = load_config().context("loading config")?;
    Ok(())
}
```

---

## 4. Correctness Footguns

**Do**
- Use `checked_add` / `saturating_add` / `wrapping_add` for integer arithmetic where overflow is possible
- Mark every `unsafe` block with a `// SAFETY:` comment explaining the invariant upheld
- Keep `unsafe` blocks minimal — push unsafe to the narrowest possible scope
- Handle `Mutex::lock()` poisoning explicitly (`.unwrap_or_else(|e| e.into_inner())` or propagate)
- Avoid shadowing variables across non-trivial scopes

**Don't**
- Assume debug-mode panic-on-overflow protects release builds (it does not)
- Hold a `MutexGuard` across an `.await` point — drop the lock before yielding
- Compare floats with `==`; use epsilon comparisons or `ordered_float`
- Expand `unsafe` scope "for convenience"

```rust
// integer overflow
let count = a.checked_add(b).ok_or(Error::Overflow)?;

// SAFETY: ptr is non-null and aligned, lifetime is bounded by `buf`
unsafe { ptr.write(value) };

// drop lock before await
let val = {
    let guard = mutex.lock().unwrap();
    guard.clone()
}; // guard dropped here
async_call(val).await;
```

---

## 5. Concurrency & Async

**Do**
- Mark shared types with `Send + Sync` bounds at API boundaries; let the compiler enforce them
- Use `std::sync::mpsc` or `crossbeam::channel` for thread-based message passing
- Use `tokio::sync::mpsc` / `broadcast` for async message passing
- Wrap blocking calls with `tokio::task::spawn_blocking`
- Use `tokio::select!` for racing futures; annotate cancellation safety in doc comments
- Use `tokio::task::JoinSet` for structured concurrency (spawn + await all)
- Prefer message passing over shared `Arc<Mutex<T>>` for complex state

**Don't**
- Call blocking I/O (`std::fs`, `std::net`, `thread::sleep`) on the async runtime thread
- Hold an `Arc<Mutex<T>>` lock across `.await` (deadlock + cancel unsafety)
- Spawn unbounded tasks without backpressure

```rust
// spawn_blocking for CPU/blocking work inside async
let result = tokio::task::spawn_blocking(|| expensive_computation()).await?;

// JoinSet for structured async concurrency
let mut set = JoinSet::new();
for item in items {
    set.spawn(process(item));
}
while let Some(res) = set.join_next().await {
    res??;
}
```

---

## 6. Memory & Performance

**Do**
- `Box<T>` for heap allocation / recursive types / large values to avoid stack copies
- `Rc<T>` for single-threaded shared ownership; `Arc<T>` for multi-threaded
- `Cow<'_, T>` to defer allocation until mutation is needed
- Pre-size collections: `Vec::with_capacity(n)`, `HashMap::with_capacity(n)`
- Prefer generics (monomorphization) over `&dyn Trait` for hot paths; use `&dyn Trait` to reduce code size at cold paths

**Don't**
- `.clone()` in hot loops without profiling justification
- Reach for `unsafe` for performance before measuring with a profiler
- Use `Box<dyn Error>` in tight inner loops (heap allocation per error)

```rust
// Cow avoids allocation when input is already correct
fn normalize(s: &str) -> Cow<'_, str> {
    if s.chars().all(|c| c.is_lowercase()) {
        Cow::Borrowed(s)
    } else {
        Cow::Owned(s.to_lowercase())
    }
}

// pre-size
let mut map = HashMap::with_capacity(items.len());
```


---

## References

Bundled deep-dives — load the file when the task reaches it.

- **`references/tooling-and-limits.md`** — clippy, rustfmt, `cargo deny`, `rust-toolchain.toml`, the size and complexity budget table, `clippy.toml` thresholds, `[lints]` config, and "Getting back under budget". Read when setting up or fixing the project's gates, or when a function, `impl` block, or module is over budget.
- **`references/project-layout.md`** — one type per module file, `foo.rs` over `mod.rs`, `pub use` re-exports, visibility, `src/bin`, `benches`, `examples`, `build.rs`, feature flags, and full single-crate and workspace trees. Read when creating a module, splitting a crate, or deciding where code belongs.
- **`references/testing.md`** — `#[cfg(test)]` colocation, `tests/` integration tier, `rstest`, `proptest`, `insta`, `criterion`, `nextest`, `#[tokio::test]`, fakes over mocks, doctests, `miri`, and `llvm-cov`. Read when writing or reviewing tests.
