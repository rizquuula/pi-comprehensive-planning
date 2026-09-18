# Python Packaging, Object Orientation & Project Layout

Reference for `python-best-practices`. Read when you start a project, add a package, decide where a class lives, or review directory structure.

---

## Packaging & Environments

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

## Object Orientation & File Granularity

Default to OOP, and give every class its own file. Cohesion lives in the *directory*, not in a module that accumulates types.

**Do**
- Model each concept as a class — state and the behavior over it stay together; collaborators arrive through `__init__`, not module globals
- **One class per module.** `class InvoiceRepository` lives in `invoice_repository.py` — file name is the class name in snake_case, so the file tree is a class index
- Re-export the public classes from the package's `__init__.py` so callers still write `from myapp.billing import InvoiceService`, not the deep path
- Group the one-class modules into a package per feature/domain — the directory carries the cohesion the file no longer does
- Treat dataclasses, Pydantic models, `Enum`s, `Protocol`s and exceptions as classes: same rule, own file each
- Keep module-level functions to factories for *that* module's class (`def from_env() -> Settings`); anything else is a method on some class
- Prefer a `Protocol` in its own file plus one file per implementation over a module holding the port and its adapter together

```
src/myapp/billing/
├── __init__.py                  # re-exports: InvoiceService, InvoiceRepository, Invoice
├── invoice.py                   # class Invoice
├── invoice_service.py           # class InvoiceService
├── invoice_repository.py        # class InvoiceRepository  (Protocol)
├── postgres_invoice_repository.py   # class PostgresInvoiceRepository
└── errors/
    ├── __init__.py
    ├── billing_error.py         # class BillingError(AppError)
    └── invoice_not_found_error.py
```

The one narrow exemption: a private helper class that is unusable outside its owner — a nested state machine, an internal cursor — may stay in the owner's file. It is implementation detail, not a second public class. Everything else moves.

No linter enforces this; it is a naming and review convention. The payoff is that `git log` per class is exact, merge conflicts stop colliding across unrelated types, and grep-by-filename finds the definition without a symbol index.

**Don't**
- `models.py` / `schemas.py` / `errors.py` holding five classes — that's a package (`models/`) whose files were never split
- Loose-function utility modules (`helpers.py`, `utils.py`) — the function belongs to the class it operates on, or to a class that doesn't exist yet
- State threaded through module globals or dicts passed between functions — that state is a class asking to be written
- Split one class across two files to duck the 150-line class budget (see `tooling-and-limits.md`) — a class too big for one file is two classes, not two files
- Bare procedural scripts inside `src/` — the entry point may be a function; the work it calls is objects

---

## Project Layout

**Do**
- `src/` layout: package under `src/mypackage/`, keeping it off `sys.path` so tests exercise the *installed* package
- Tests in a top-level `tests/` mirroring the package structure; shared fixtures in `tests/conftest.py`
- One `pyproject.toml` at the root as the single config source (build, deps, ruff, mypy, pytest)
- Define the public API in `__init__.py` via explicit re-exports; keep internals in private modules (`_internal.py`)
- Group by feature/domain, not by technical layer — `billing/` beats `models/ + services/ + schemas/` once there is more than one domain
- One class per file inside those packages (see the section above) — expect many small modules and a package wherever a single module would have held several types

**Small library** — the floor; don't build more structure than this until it hurts:

```
myproject/
├── pyproject.toml           # build, deps, ruff, mypy, pytest — single source
├── README.md
├── .gitignore
├── src/
│   └── mypackage/
│       ├── __init__.py      # public API re-exports only
│       ├── py.typed         # ship type hints (PEP 561)
│       ├── parser.py        # class Parser
│       ├── writer.py        # class Writer
│       └── _token_buffer.py # private, no stability guarantee
└── tests/
    ├── conftest.py
    └── test_parser.py
```

**Application / service** — feature-first, with the boundary layers isolated:

```
myapp/
├── pyproject.toml
├── uv.lock                        # exact pins; loose ranges live in pyproject
├── .env.example                   # documents required vars; .env is gitignored
├── Makefile                       # make lint / test / run — one entry point
├── docker-compose.yml
├── docs/
│   └── architecture.md
├── migrations/                    # alembic; never edit an applied revision
│   └── versions/
├── scripts/                       # one-off ops tasks, not importable app code
│   └── seed_db.py
├── src/
│   └── myapp/
│       ├── __init__.py
│       ├── __main__.py            # python -m myapp
│       ├── config.py              # env → typed settings object, loaded once
│       ├── logging.py
│       ├── domain/                # pure business logic — zero framework imports
│       │   ├── __init__.py
│       │   ├── models/            # one value object / entity per file
│       │   │   ├── __init__.py
│       │   │   ├── money.py
│       │   │   └── customer.py
│       │   └── errors/            # AppError hierarchy, one exception per file
│       │       ├── __init__.py
│       │       └── app_error.py
│       ├── billing/               # a feature slice: owns its own everything
│       │   ├── __init__.py        # the slice's public surface
│       │   ├── invoice_service.py     # use case class
│       │   ├── invoice_repository.py  # persistence port (Protocol)
│       │   ├── postgres_invoice_repository.py  # its adapter
│       │   └── schemas/           # pydantic DTOs at the edge, one per file
│       ├── accounts/
│       │   └── ...                # same shape
│       ├── adapters/              # outbound: DB, cache, HTTP clients, queues
│       │   ├── __init__.py
│       │   ├── postgres.py
│       │   └── stripe_client.py
│       └── api/                   # inbound: FastAPI/Flask routes, CLI
│           ├── __init__.py
│           ├── deps.py            # DI wiring
│           └── routes/
│               ├── billing.py
│               └── health.py
└── tests/
    ├── conftest.py                # session-wide fixtures
    ├── unit/                      # mirrors src/, no IO, milliseconds
    │   └── billing/
    │       └── test_service.py
    ├── integration/               # real DB/broker via testcontainers
    │   └── test_postgres_repo.py
    └── e2e/
        └── test_checkout_flow.py
```

Dependencies point inward: `api/` and `adapters/` may import `domain/`; `domain/` imports neither. Enforce it with `ruff`'s `TID` rules or `import-linter` rather than trusting review.

**Don't**
- Flat layout (package at repo root) — tests may import the source tree instead of the installed package
- A `tests/` directory shipped inside the wheel — keep it out of the package
- A package directory that will only ever hold one module — collapse it next to its siblings (many small modules is expected under the rule above; empty nesting is not)
- A top-level `utils/` or `common/` — it becomes the dumping ground every module depends on
- `models.py` / `services.py` / `schemas.py` as top-level buckets once there are 3+ domains — a change to one feature then touches every file
- Business logic in `api/` route handlers — routes parse, delegate, and serialize; nothing else
- Reading `os.environ` outside `config.py` — env access scattered through the tree is untestable
