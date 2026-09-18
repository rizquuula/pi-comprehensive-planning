# Python Testing

Reference for `python-best-practices`. Read when you write, review, or plan pytest suites.

---

## Testing

Mechanics only — for the red-green-refactor process and how wide to sweep per change, use `test-driven-development`.

**Do**
- `pytest` only: plain `assert`, plain functions, no `unittest.TestCase` in new code
- Name the behavior, not the method: `test_charge_declines_when_card_expired` — the failure line should read as a bug report
- Arrange–Act–Assert, with one behavior asserted per test; multiple `assert`s on *one* outcome is fine
- Assert on observable behavior — return values, raised errors, persisted rows — never on internal call order
- `@pytest.mark.parametrize` for table cases; put the expected value in the table, not in a branch inside the test
- `pytest.raises(Err, match="...")` — a bare `pytest.raises(ValueError)` passes on the wrong `ValueError`
- Builtin fixtures before writing your own: `tmp_path`, `monkeypatch`, `caplog`, `capsys`, `tmp_path_factory`
- Inject clocks, IDs, and randomness as parameters (`now: Callable[[], datetime] = datetime.now`) — deterministic without patching stdlib
- Mock at boundaries you own (the repository port), not the vendor SDK three layers down; patch where the name is *used*, not where it's defined
- Fakes over mocks for anything stateful — an in-memory repository implementing the same `Protocol` beats six `when(...).thenReturn(...)` lines
- `pytest-asyncio` (`asyncio_mode = "auto"`) or `anyio` for coroutines; assert cancellation and timeout paths too
- Integration tests against the real engine via `testcontainers` — SQLite standing in for Postgres tests a different database
- Branch coverage (`--cov-branch`) as a gap-finder, with a floor on new code; failing the build at a global percentage just breeds assertion-free tests
- `hypothesis` where an invariant is easy to state and examples are not (round-trips, parsers, money arithmetic)

```python
@pytest.mark.parametrize(
    ("kind", "amount", "expected"),
    [
        ("wire", Decimal("100"), Decimal("3.00")),
        ("ach", Decimal("100"), Decimal("1.00")),
        ("wire", Decimal("0"), Decimal("0.00")),
    ],
)
def test_fee_applies_rate_per_kind(kind, amount, expected):
    assert fee(kind, amount) == expected


def test_fee_rejects_unknown_kind():
    with pytest.raises(UnknownFeeKindError, match="crypto"):
        fee("crypto", Decimal("100"))
```

Factory fixtures keep setup honest — one fixture, many shapes, defaults visible at the call site:

```python
@pytest.fixture
def make_order():
    def _make(*, total=Decimal("10"), items=1, active=True) -> Order:
        return Order(
            total=total,
            items=[Item()] * items,
            customer=Customer(is_active=active),
        )
    return _make


def test_charge_skips_inactive_customer(make_order):
    assert charge(make_order(active=False)) is None
```

**Don't**
- `time.sleep()` to wait for anything — inject the clock, or poll a condition with a timeout
- Network, real credentials, or the developer's own DB in `tests/unit/` — that tier must run offline in milliseconds
- Tests that depend on execution order or leak state through module globals — each must pass alone via `pytest --ff -x` and under `pytest-randomly`
- Mocking the object under test, or asserting `mock.assert_called_once_with` as the *only* assertion — that tests your wiring, not your logic
- Logic in tests: `if`, loops, or computing the expected value with the same formula the code uses — the test then agrees with the bug
- Giant `conftest.py` fixtures nobody can trace (the "mystery guest") — prefer explicit factories over autouse fixtures
- Asserting on exact log strings or full JSON blobs — assert on the fields that carry meaning
- Chasing 100% coverage by testing getters and `__repr__`; untested error branches are the real gap
- Deleting or `xfail`-ing a flaky test without diagnosing it — flakiness is usually a real race in the code
