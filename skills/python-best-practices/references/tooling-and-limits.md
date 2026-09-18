# Python Tooling, Size & Complexity Limits

Reference for `python-best-practices`. Read when you configure linters/formatters, set size budgets, or refactor code that crossed a budget.

---

## Tooling

**Do**
- `ruff check . --fix` for lint; `ruff format .` for formatting (replaces `black` + `isort` + `flake8`)
- `mypy --strict src/` or `pyright` in CI — fail the build on type errors
- `pytest` with fixtures and `@pytest.mark.parametrize` for data-driven tests; no `unittest` in new code
- Pre-commit hooks: `ruff`, `mypy`, `pytest -x` on changed files
- `uv` for fast dep resolution and virtualenv management

```toml
# pyproject.toml
[tool.ruff]
line-length = 88
[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM"]
```

Extend that `select` with the complexity rules below to make the size budgets enforceable.

**Don't**
- `pylint` as primary linter — `ruff` covers the same rules faster
- Skip CI type-checking because "it's just a script" — footguns compound over time
- Mix `pytest` and `unittest.TestCase` in the same suite without a clear reason
- Commit without running `ruff check` — formatting churn pollutes diffs

---

## Size & Complexity Limits

Budgets, not gates — cross one and look for the seam, don't split mechanically at the boundary.

| Unit | Target | Pause | Refactor |
|---|---|---|---|
| Line length | ≤ 88 chars (ruff/black default) | 100 | hard cap — let the formatter wrap |
| Function / method | ≤ 30 lines | 50 | 80 — extract, or it's doing two jobs |
| Class | ≤ 150 lines | 200 | 300 — split responsibilities |
| Module (`.py`) | 100–300 lines | 400 | 500 — promote to a package directory |
| Parameters | ≤ 4 positional | 5 | 6 — pass a `@dataclass` / keyword-only args |
| Nesting depth | ≤ 3 | 4 | guard-clause it back down |
| Cyclomatic complexity | ≤ 8 | 10 | 12 — split branches into named helpers |
| `__init__.py` | re-exports only | — | any logic belongs in a real module |

**Do**
- Enforce it in `pyproject.toml` so the numbers aren't folklore:

```toml
[tool.ruff]
line-length = 88

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "C90", "PL"]

[tool.ruff.lint.mccabe]
max-complexity = 10

[tool.ruff.lint.pylint]
max-args = 5
max-branches = 12
max-statements = 50
```

- Turn a module into a package the moment it crosses ~500 lines: `core.py` → `core/{__init__.py,parser.py,writer.py}` — importers keep working
- Force keyword-only args past 3 params: `def f(a, b, *, retries=3, timeout=5.0)`
- Count *logical* lines — a 200-line module that is 150 lines of literal test fixtures or a generated schema is fine

**Don't**
- `# noqa: E501` scattered to dodge line length — reformat or extract a local variable
- Long functions kept whole because "the steps are sequential" — sequential steps name well
- Split a coherent module into `helpers.py` + `utils.py` just to get under 300 lines
- Count docstrings against a function's budget — good docstrings are not bloat

### Getting back under budget

Complexity is branches × nesting. Work down this list in order — the first three fix most violations.

**1. Guard clauses — invert and return early.** Kills nesting depth outright.

```python
# depth 4
def charge(order):
    if order is not None:
        if order.items:
            if order.customer.is_active:
                return gateway.charge(order.total)
    return None

# depth 1
def charge(order: Order | None) -> Receipt | None:
    if order is None:
        return None
    if not order.items:
        return None
    if not order.customer.is_active:
        return None
    return gateway.charge(order.total)
```

**2. Extract a named helper per step.** A comment explaining a block is the block's future function name — the comment becomes the name, and the name replaces the comment.

**3. Dispatch dict over `if`/`elif` chains.** An 8-branch chain becomes complexity 1 and grows without touching the function.

```python
# complexity 8
def fee(kind, amount):
    if kind == "wire": return amount * Decimal("0.03")
    elif kind == "ach": return amount * Decimal("0.01")
    ...  # 6 more

# complexity 1, and new kinds are data
_RATES: Final[dict[str, Decimal]] = {"wire": Decimal("0.03"), "ach": Decimal("0.01")}

def fee(kind: str, amount: Decimal) -> Decimal:
    try:
        return amount * _RATES[kind]
    except KeyError:
        raise UnknownFeeKindError(kind) from None
```

**4. `match` for genuine structural branching** (3.10+) — flatter than nested `isinstance` checks and the type checker narrows each arm.

**5. Bundle parameters into a `@dataclass`.** Six params that always travel together are one missing concept; the dataclass is also where validation lands (`__post_init__`), which deletes guards from every caller.

**6. Replace flag params with separate functions.** `def send(msg, *, dry_run=False)` is two functions sharing a body — every `if dry_run` doubles the paths through it.

**7. Push loop bodies into comprehensions or `itertools`.** `filter`+`map`+accumulate loops with `continue` collapse into one expression; when the body is still too big, the comprehension calls the helper from (2).

**8. Polymorphism / `Protocol` when the same `if kind ==` chain appears in more than two functions** — that's a type wearing a string. One class per variant, dispatch disappears.

**9. Decorators or context managers for cross-cutting noise.** Retry, timing, logging, transaction boundaries are not the function's logic; `@retry(3)` and `with transaction():` take the branches with them.

**10. Table-driven validation.** A rule list iterated once beats fifteen sequential `if not valid: raise` blocks, and the rules become testable data.

**Don't** trade complexity for indirection: five one-line helpers called once each, in order, is the same function with extra jumps. Extract when the piece has a name, a boundary, and ideally its own test — not to satisfy the linter.
