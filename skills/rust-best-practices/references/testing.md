# Rust Testing

Test mechanics for Rust.

---

## Testing

Mechanics only — for the red-green-refactor process and how wide to sweep per change, use `test-driven-development`.

**Do**
- Colocate unit tests in the module they test: `#[cfg(test)] mod tests { use super::*; }` — they see private items, and they compile out of release builds
- Put API-level tests in `tests/`; each file is a separate crate that links your crate as a consumer, so it exercises **only** the public surface. That constraint is a feature — it catches a missing `pub use`
- Name the behavior, not the function: `fn charge_declines_when_card_expired()` — the failure line should read as a bug report
- Return `Result` from tests so setup can use `?` instead of a wall of `.unwrap()`
- `#[should_panic(expected = "invalid header")]` — a bare `#[should_panic]` passes on *any* panic, including one from broken setup. Better still, return `Result` and assert on the error variant with `matches!`
- Give `assert!` a message with the actual values: `assert!(t < limit, "took {t:?}, limit {limit:?}")`. `assert_eq!` already prints both sides
- `rstest` for table cases and fixtures; `#[case(...)]` rows generate one named test each, so failures point at the row
- `proptest` (or `quickcheck`) where the invariant is easy to state and examples are not — round-trips, parsers, arithmetic. Commit the `proptest-regressions/` file so shrunk counterexamples stay tested
- `insta` for snapshot-testing anything with a large stable rendering (CLI output, generated SQL, `Debug` of a config); review with `cargo insta review`, and keep snapshots small enough to read in a diff
- `criterion` in `benches/` for performance claims; a number in a commit message without a benchmark is a guess
- `cargo nextest run` for speed and per-test process isolation; `cargo test -- --nocapture` when you need `println!`/`dbg!` output, `--test-threads=1` to expose order dependence
- `#[tokio::test]` for async, and test the cancellation and timeout paths explicitly — `tokio::time::pause()` plus `advance()` makes timeouts instant and deterministic
- Hand-written fakes implementing the trait for anything stateful — an in-memory `InvoiceRepository` beats six mock expectations and survives refactors. Reach for `mockall` only when you need to assert an interaction that has no observable result
- Inject clocks and randomness as a generic param or `Arc<dyn Clock>` — deterministic without patching anything global
- `tempfile::TempDir` for filesystem tests (cleaned up even on panic); `testcontainers` for the real engine when the code speaks SQL — SQLite standing in for Postgres tests a different database
- Doctests as executable documentation: every public item's example is compiled and run by `cargo test`. Use `?` in doctests with a `fn main() -> Result<...>` wrapper or the hidden `# ` lines
- `cargo miri test` on any crate containing `unsafe` — it catches UB that passes every normal test
- `cargo llvm-cov` as a gap-finder with a floor on new code; a global percentage gate just breeds assertion-free tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rstest::{fixture, rstest};

    #[rstest]
    #[case(Rail::Wire, Money::from_major(100), Money::from_minor(300))]
    #[case(Rail::Ach,  Money::from_major(100), Money::from_minor(100))]
    #[case(Rail::Wire, Money::ZERO,            Money::ZERO)]
    fn fee_applies_rate_per_rail(
        #[case] rail: Rail,
        #[case] amount: Money,
        #[case] expected: Money,
    ) {
        assert_eq!(rail.fee(amount), expected);
    }

    #[fixture]
    fn order() -> Order {
        Order::new(CustomerId::new(1), vec![Item::sample()])
    }

    #[rstest]
    fn charge_rejects_inactive_customer(order: Order) -> Result<(), BillingError> {
        let repo = InMemoryInvoiceRepository::default();   // fake, not a mock
        let service = InvoiceService::new(repo, FixedClock::at("2024-01-01T00:00:00Z"));

        let err = service.charge(order.deactivated()).unwrap_err();

        assert!(matches!(err, BillingError::InactiveCustomer { .. }), "got {err:?}");
        Ok(())
    }
}
```

```rust
// tests/parse_roundtrip.rs — integration tier: public API only
use my_crate::{parse, render};

proptest::proptest! {
    #[test]
    fn render_then_parse_is_identity(doc in my_crate::testing::arb_document()) {
        let parsed = parse(&render(&doc)).expect("rendered output must parse");
        proptest::prop_assert_eq!(parsed, doc);
    }
}
```

**Don't**
- `thread::sleep` to wait for anything — use `tokio::time::pause()`, or poll a condition with a deadline
- Network calls, real credentials, or a developer's own database in `#[cfg(test)]` unit tests — that tier runs offline in milliseconds
- Bare `#[should_panic]`, or `unwrap()` in test *setup* where the panic message won't say what failed — `expect("seed the repo")` at minimum
- Tests that share state through `static mut`, a global `OnceLock` fixture, or a fixed filesystem path — `cargo test` runs them in parallel threads and `nextest` in parallel processes
- Mocking the type under test, or asserting only `mock.expect_save().times(1)` — that tests wiring, not behaviour
- Logic in tests: branches, loops, or recomputing the expectation with the same formula the code uses — the test then agrees with the bug
- Giant `insta` snapshots nobody reviews; a 400-line snapshot is a rubber stamp, not an assertion
- Chasing 100% coverage over `Debug` impls and getters while error branches stay untested
- `#[ignore]` on a flaky test without diagnosing it — flakiness in Rust is usually a real race or a real timing assumption
- Benchmarks in `#[test]` functions with manual `Instant::now()` — noise swamps the signal; use `criterion`
