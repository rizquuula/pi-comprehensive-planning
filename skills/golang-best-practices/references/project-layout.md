# Go File Granularity & Project Layout

How to split types across files, and the repository shape around them.

---

## Types & File Granularity

Go is not class-per-file — the *package* is the unit of cohesion and the unit of encapsulation. Within a package, the file is an organizational aid for humans: the compiler does not care, so the only rule worth having is one a reader can predict.

**Do**
- **One primary type plus its methods per file**, named after the type in snake_case: `type InvoiceService` lives in `invoice_service.go`. The file tree becomes a type index you can grep by filename.
- Keep the type's constructor, methods, and its own small helpers in that file — that is the whole point; splitting a type's methods across files makes the method set unfindable
- Put the package doc comment in `doc.go` when it runs longer than two lines; otherwise it sits above `package` in the most central file
- Define interfaces in the **consuming** package (SKILL.md §1 Idioms) — a `ports.go` holding the 1–3-method interfaces *this* package needs is cohesive, not a grab-bag, because they all describe one consumer's requirements
- Group sentinel error **values** in `errors.go` — `var ErrNotFound = errors.New(...)` are constants of the package, not types
- Give an error *type* with methods its own file: `validation_error.go` holds `type ValidationError` and its `Error()`/`Unwrap()`
- Keep the test file beside its subject: `invoice_service.go` → `invoice_service_test.go`
- Promote to a subpackage when a cohesive subset of files has its own vocabulary and would export a narrow surface to the rest — split by concept, never to hit a file count
- Name files for what they hold, not their layer: `order.go`, not `structs.go`

```
internal/billing/
├── doc.go                    # package doc only
├── invoice.go                # type Invoice + methods
├── invoice_test.go
├── invoice_service.go        # type InvoiceService + methods
├── invoice_service_test.go
├── money.go                  # type Money value object + arithmetic
├── status.go                 # type Status + String(), ParseStatus()
├── ports.go                  # interfaces this package consumes (each 1–3 methods)
├── errors.go                 # sentinel error values: ErrInvoiceNotFound, ...
├── validation_error.go       # type ValidationError + Error()/Unwrap()
└── postgres/                 # promoted: its own vocabulary, narrow surface
    ├── invoice_repository.go
    └── invoice_repository_test.go
```

The narrow exemption: small types that only exist to serve the primary type — an unexported cursor, a state-machine step, a two-field key — stay in the owner's file. They are implementation detail, not a second concept. The moment one gets used by a sibling file, it earns its own.

No linter enforces this; it is a naming and review convention. The payoff is that `git log` per type is exact, merge conflicts stop colliding across unrelated types, and the definition is findable without a symbol index.

**Don't**
- `types.go` / `models.go` / `structs.go` holding eight unrelated types — that is a package whose files were never split, or a package that should be several
- `errors.go` holding five error *types* with method sets — sentinel values yes, types no
- `utils.go` / `helpers.go` / `common.go` — the function belongs on the type it operates on, or on a type that hasn't been written yet
- Split one type's methods across `order.go` and `order_methods.go` to duck the file budget (`tooling-and-limits.md`) — a type too big for one file is two types
- Create a subpackage that will hold one file forever, or nest three levels to express a taxonomy — Go favors short, flat import paths
- Mirror Java/Python and give every interface its own file when the consumer needs three of them — one `ports.go` reads better and keeps the requirement set visible at once

---

## Project Layout

For service layering, ports/adapters, and the domain/app/adapter split in depth, see `hexagonal-architecture-go` — this section covers only the repository shape those layers sit in.

**Do**
- `go.mod` at the repository root; one module per repo until you have a hard reason for more (multi-module repos complicate every tool that takes `./...`)
- `cmd/<binary>/main.go` per entry point; keep `main` thin — parse config, construct, run, handle signals
- `internal/` for everything else — the compiler refuses imports from outside the module, which makes it the only *enforced* boundary Go gives you
- One package per directory, named for what it provides; group by domain concept, not technical layer
- A flat root for a small library — do not impose `cmd/`/`internal/` on a single-package module
- A `Makefile` (or `Taskfile`) as the one entry point CI and humans share: `make lint test build`
- `api/` for the contract artifacts (OpenAPI spec, `.proto`) with generated code written to `internal/gen/` and regenerated, never hand-edited
- `migrations/` with immutable, numbered files — never edit an applied migration

**Small library / CLI** — the floor; don't build more structure than this until it hurts:

```
mytool/
├── go.mod                    # module github.com/me/mytool
├── go.sum
├── Makefile                  # make lint / test / build
├── README.md
├── .golangci.yml             # baseline + complexity settings (`tooling-and-limits.md`)
├── doc.go                    # package doc for the root package
├── parser.go                 # type Parser + methods
├── parser_test.go
├── writer.go                 # type Writer + methods
├── token.go                  # type Token
├── testdata/                 # ignored by the go tool; golden files live here
│   └── golden/valid.json
└── cmd/
    └── mytool/main.go        # thin CLI over the library API
```

Root-package library + `cmd/` binary is the idiomatic pairing: importers get `github.com/me/mytool`, users get a binary, and neither pays for the other.

**Application / service** — boundaries isolated, everything private by default:

```
myservice/
├── go.mod
├── Makefile
├── .golangci.yml
├── docker-compose.yml             # local Postgres/Kafka for integration tests
├── api/
│   ├── openapi.yaml               # the contract, hand-written, reviewed
│   └── order/v1/order.proto
├── migrations/                    # numbered, immutable once applied
│   ├── 0001_create_orders.up.sql
│   └── 0001_create_orders.down.sql
├── cmd/
│   ├── server/main.go             # composition root: config → construct → serve
│   └── migrate/main.go            # ops entry point, same internal packages
├── internal/                      # compiler-enforced: no other module can import this
│   ├── config/                    # env → typed struct, loaded exactly once
│   ├── domain/                    # pure business rules; stdlib only
│   │   └── order/                 # entity, value objects, sentinel errors
│   ├── app/                       # use cases; one package per use case
│   │   └── placeorder/            # usecase.go + ports.go (consumer interfaces)
│   ├── adapter/
│   │   ├── primary/http/          # driving: handlers, DTOs, routing
│   │   └── secondary/postgres/    # driven: repositories, SQL, row types
│   ├── platform/                  # cross-cutting: logging, tracing, metrics
│   └── gen/                       # generated: sqlc, protoc, mockless codegen
├── pkg/                           # usually absent — see below
├── scripts/                       # ops one-offs; not importable app code
└── testdata/                      # fixtures + golden files
```

`pkg/` is usually a mistake: it means "any repository on the internet may import this and I now owe it compatibility." Default everything to `internal/` and move a package to `pkg/` only when a *separate repository* actually imports it. `internal/` is not a convention — the toolchain rejects the import — so it is the cheapest architectural enforcement available.

**Dependency direction.** Dependencies point inward: `cmd/` → `adapter/` → `app/` → `domain/`, never the reverse, and never adapter → adapter. Enforce it rather than trusting review:

- `internal/` sub-trees make the module boundary free (`internal/gen/internal/...` narrows further)
- `depguard` in golangci-lint pins per-directory import rules and fails CI:

```yaml
linters:
  enable: [depguard]
  settings:
    depguard:
      rules:
        domain-is-pure:
          files: ["**/internal/domain/**"]
          deny:
            - pkg: "database/sql"
              desc: domain must not know about persistence
            - pkg: "net/http"
              desc: domain must not know about transport
            - pkg: "github.com/myorg/myservice/internal/adapter"
              desc: dependencies point inward
```

- `go-arch-lint` when the rule set outgrows deny-lists — it declares components and allowed edges in one YAML, and reports the graph

**Don't**
- `pkg/` by reflex — it is a public API promise you did not intend to make
- Layer-first top-level packages (`models/`, `services/`, `handlers/`) — one feature change then touches every directory
- Business logic in `main()` — `main` wires and runs; if it branches on domain rules, the rules escaped
- A top-level `utils/` or `common/` — it becomes the package everything depends on and nothing owns
- Reading `os.Getenv` outside `internal/config` — scattered env access is untestable and undocumented
- Deep nesting for its own sake; `internal/adapter/secondary/persistence/sql/postgres/order/` is a path, not a design
- Hand-editing anything under `internal/gen/` — the next `go generate` deletes your change
- Multi-module repos to "separate concerns" — packages already do that, and `./...` stops working
