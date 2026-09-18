---
name: python-best-practices
description: Apply when writing, reviewing, or planning Python code (.py files). Covers idiomatic Python (comprehensions, context managers, dataclasses), correctness footguns (mutable default args, late-binding closures, is vs ==, truthiness, float traps), type hints, error handling (EAFP), concurrency (asyncio, threads, the GIL, multiprocessing), packaging and virtualenvs, tooling and testing (ruff, mypy, uv/poetry, pytest, parametrize, mocking, coverage), size and complexity budgets (line length, function length, param count, nesting, mccabe), object orientation and file granularity (one class per file, class-named modules), and project layout (src/ layout, feature-first packages, pyproject.toml). Use when the user mentions Python, type hints, asyncio, pytest, ruff/black/mypy, pip/poetry/uv, function length, complexity limits, OOP, classes per file, module naming, or project structure.
---

# Python Best Practices

Defaults for correct, idiomatic Python 3.11+ — name the tradeoff when you skip one.

---

## 1. Idiomatic Python

**Do**
- Comprehensions and generators over manual loops; `sum(x**2 for x in items)` not a `for` + accumulator
- `with` for every resource — files, locks, DB connections, HTTP sessions
- Unpack sequences directly: `first, *rest = items`, `a, b = b, a`
- `enumerate(seq)` / `zip(a, b)` — never `range(len(...))`
- EAFP over LBYL: try the operation, catch the failure; don't guard with `if key in dict:` then look up
- `@dataclass` for plain data; `NamedTuple` for immutable value objects
- f-strings everywhere; no `%` formatting, no `.format()` in new code
- `pathlib.Path` over `os.path`; `Path.read_text()` / `Path.write_text()`

```python
# prefer
path = Path("data") / "file.csv"
content = path.read_text(encoding="utf-8")

# over
with open(os.path.join("data", "file.csv")) as f:
    content = f.read()
```

**Don't**
- `range(len(items))` when you need the element, not the index
- String concatenation in loops — join a list or use a generator
- `os.path` in new code (`os.path.join`, `os.path.exists`)
- Manual `__init__` for plain data containers when `@dataclass` covers it

---

## 2. Correctness Footguns

**Do**
- Use `None` as default for mutable args; instantiate inside the function body
- Capture loop variables in closures with a default arg: `lambda x=x: x`
- `is None` / `is not None` — never `== None`
- Guard truthiness carefully when `0`, `""`, `[]`, `{}` are valid values: use `if x is not None:`
- `math.isclose(a, b)` or `Decimal` for float equality; never `a == b` on floats
- `from decimal import Decimal` for money

```python
# mutable default — wrong
def append(item, lst=[]):
    lst.append(item)
    return lst

# correct
def append(item, lst=None):
    if lst is None:
        lst = []
    lst.append(item)
    return lst
```

**Don't**
- `def f(x=[])` / `def f(x={})` — classic shared-state bug
- `x is 256` — CPython caches small ints; never rely on identity for values
- `if not x:` when `x` could be `0` or `""` and those are meaningful
- Shadow builtins: `list`, `dict`, `id`, `type`, `input`, `min`, `max` as variable names
- `==` on mixed numeric types expecting exact equality

---

## 3. Type Hints & Typing Discipline

**Do**
- Annotate all public function signatures; skip `-> None` only when obvious
- `from __future__ import annotations` at top of every file (deferred evaluation)
- `X | None` (3.10+) over `Optional[X]`; `list[str]` over `List[str]`
- `Protocol` for structural typing instead of ABCs when you don't control both sides
- `TypedDict` for dict shapes; `Literal` for constrained strings/ints; `Final` for constants
- `TypeVar` / `ParamSpec` / `TypeAlias` from `typing` when needed; avoid raw `Any`
- Run `mypy --strict` or `pyright` in CI

```python
from __future__ import annotations
from typing import Protocol, Final

MAX_RETRIES: Final = 3

class Serializable(Protocol):
    def to_dict(self) -> dict[str, object]: ...
```

**Don't**
- `Any` as an escape hatch without a `# type: ignore` comment explaining why
- Importing from `typing` what's available in builtins (`List`, `Dict`, `Tuple`, `Set`)
- Annotating only some params — partial annotations mislead the type checker
- Skipping mypy/pyright in CI — type errors accumulate silently

---

## 4. Error Handling

**Do**
- Narrow `except` to the exact exception type(s); never bare `except:`
- Chain exceptions: `raise DomainError("...") from original_exc`
- Build a hierarchy: one base `AppError(Exception)`, subtypes per domain
- `finally` / context managers for cleanup — not duplicated in `try` and `except`
- `contextlib.suppress(FileNotFoundError)` for genuinely ignorable errors
- Let unexpected exceptions propagate; catch only what you can handle

```python
try:
    result = parse(payload)
except ValueError as exc:
    raise InvalidPayloadError(f"bad payload: {payload!r}") from exc
```

**Don't**
- `except Exception: pass` — swallows bugs silently
- Bare `except:` — catches `KeyboardInterrupt`, `SystemExit`, generator `StopIteration`
- Catching broad types (`Exception`) when you only handle one subtype
- Logging the error AND re-raising without chaining — duplicates noise

---

## 5. Concurrency

**Do**
- `asyncio` for IO-bound concurrency (network, disk, DB) — one event loop, many coroutines
- `multiprocessing` / `concurrent.futures.ProcessPoolExecutor` for CPU-bound work (bypasses the GIL)
- `threading` / `ThreadPoolExecutor` for blocking IO you can't make async
- `asyncio.gather()` or `asyncio.TaskGroup` (3.11+) to fan out coroutines
- Cancel tasks cleanly: `task.cancel()`, handle `asyncio.CancelledError` without swallowing it
- Avoid shared mutable state across threads; use `asyncio.Queue` or `multiprocessing.Queue`

```python
async def fetch_all(urls: list[str]) -> list[str]:
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch(u)) for u in urls]
    return [t.result() for t in tasks]
```

**Don't**
- CPU-bound work in `asyncio` without `loop.run_in_executor` — blocks the event loop
- `time.sleep()` inside a coroutine — use `await asyncio.sleep()`
- Threads for CPU-bound code expecting parallel speedup — the GIL serializes them
- `asyncio.run()` inside an already-running event loop (Jupyter: use `await` directly)
- Mutable global state shared across threads without locks

---

## 6. Data & Performance

**Do**
- Generators for large sequences — `(x for x in big_file)` streams, lists load all at once
- `__slots__` on data-heavy classes to cut per-instance dict overhead
- `collections.deque` for queues, `Counter` for tallying, `defaultdict` to avoid key guards
- `functools.cache` / `functools.lru_cache` for pure expensive functions
- `itertools.chain`, `islice`, `groupby`, `product` — prefer stdlib over manual loops
- Profile before optimizing; `cProfile` + `snakeviz` first

```python
from functools import cache

@cache
def fib(n: int) -> int:
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

**Don't**
- `float` for money — use `Decimal` or integer cents
- `list` as a queue (`list.pop(0)` is O(n)) — use `collections.deque`
- Premature `__slots__` on classes not instantiated by the thousands
- `+` to concatenate many strings in a loop — `"".join(parts)` or a list then join

---

## 7. Packaging & Environments

**Do**
- Always work inside a virtualenv; `uv venv` or `python -m venv .venv`
- `pyproject.toml` as the single config file (PEP 518/621); no `setup.py` in new projects
- Pin exact versions in lock files (`uv.lock`, `poetry.lock`); loose ranges in `pyproject.toml`
- src layout: `src/mypackage/` keeps the installed package off `sys.path` during tests
- Separate dependency groups: `[project.optional-dependencies]` for dev/test/docs

**Don't**
- Commit `.venv/`, `__pycache__/`, `*.egg-info/`, `.env` files — all in `.gitignore`
- `pip install` globally on a dev machine — use virtualenvs
- Mix `requirements.txt` + `pyproject.toml` as dual sources of truth
- Hardcode secrets in source — use environment variables or a secrets manager

---

## References

Bundled deep-dives — load the file when the task reaches it.

- **`references/tooling-and-limits.md`** — `ruff`, `mypy`/`pyright`, pre-commit hooks, `uv`, the size and complexity budget table, the enforcing `pyproject.toml` block, and "Getting back under budget". Read when you set up or audit the project gates, or when a function, class, or module is over budget.
- **`references/project-layout.md`** — packaging and virtualenvs, one class per module, snake_case file naming, `__init__.py` re-exports, `src/` layout, feature-first packages, and full directory trees. Read when you start a project, add a package, or decide where a class belongs.
- **`references/testing.md`** — `pytest` only, behavior-named tests, `parametrize` tables, `pytest.raises(match=...)`, builtin fixtures, fakes over mocks, `pytest-asyncio`, `testcontainers`, `hypothesis`, and branch coverage. Read when you write or review tests.
