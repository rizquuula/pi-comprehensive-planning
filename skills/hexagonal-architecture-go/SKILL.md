---
name: hexagonal-architecture-go
description: Designing, structuring, and reviewing Go services using hexagonal architecture (ports & adapters / clean architecture). Covers the Go-idiomatic package layout (cmd/, internal/domain, internal/app, internal/adapter), consumer-side interface definition, ports shaped by the core's needs rather than the vendor's API, DI via plain constructors in main.go, per-layer testing strategy, and the Go-specific failure modes that quietly destroy a hexagonal codebase. Use whenever the user mentions hexagonal architecture, ports and adapters, clean architecture in Go, onion architecture, application core, or is scoping/designing a new Go service or refactoring an existing one toward domain-centric layering — even if they don't say the word "hexagonal" explicitly. For deeper theory (origins, multi-bounded-context layout, events, CQRS, anti-pattern deep-dives), see the bundled references/.
---

# Hexagonal Architecture in Go

Go-specific decisions that turn the pattern into a codebase that holds together. Win conditions:

- Domain readable as business, with no idea Postgres exists.
- Swap HTTP→gRPC or Postgres→Dynamo without touching business logic.
- Domain tests run in milliseconds, no Docker, no mock framework.
- A new contributor finds where any rule lives in under a minute.

If a decision doesn't serve at least one of those, push back on it.

## Reference files — load when relevant
- **`references/origins.md`** — Cockburn's framing, API/SPI vocabulary, hexagonal vs Onion/Clean/DDD. Load when discussing with reviewers reaching for canonical vocabulary.
- **`references/multi-bounded-context.md`** — package-by-component layout, no-cross-context-imports rule, when to extract services. Load when the service is outgrowing one core domain.
- **`references/events-and-cqrs.md`** — domain vs application events, publish lifecycle, CQRS as an optional shape. Load when designing event-driven flows or read/write scaling.
- **`references/anti-patterns.md`** — extended bad/good pairs for the failure modes below. Load during code review or when a port looks leaky.

## Package layout (single bounded context)
```
myservice/
├── cmd/myservice/main.go              # composition root
├── internal/
│   ├── domain/                        # pure business; stdlib only, ideally
│   │   └── order/
│   │       ├── order.go               # entity (behavior, unexported fields)
│   │       ├── money.go               # value object
│   │       └── errors.go              # domain errors
│   ├── app/                           # use cases (one package per use case)
│   │   └── placeorder/
│   │       ├── usecase.go
│   │       ├── ports.go               # SPI interfaces the use case needs
│   │       └── usecase_test.go
│   ├── adapter/
│   │   ├── primary/                   # driving: things that call us
│   │   │   ├── http/
│   │   │   └── grpc/
│   │   └── secondary/                 # driven: things we call
│   │       ├── postgres/
│   │       └── kafka/
│   └── platform/                      # cross-cutting: config, logging, tracing
└── go.mod
```

- **No `internal/port/` junk drawer** — ports live with the use case that owns them; centralizing is a Java reflex that creates cycles.
- **One package per bounded concept, not technical kind** — `internal/domain/order/` holds entity, VOs, errors, events; not `entities/`, `valueobjects/`.
- **`pkg/` stays empty** until something is genuinely consumed by a separate repo; don't pay the public API cost speculatively.

## The two Go idioms that matter

### 1. Consumer-side interfaces
```go
// internal/app/placeorder/ports.go — use case declares what it needs
package placeorder
type OrderRepository interface {
    Save(ctx context.Context, o *order.Order) error
}

// internal/adapter/secondary/postgres/order_repo.go — satisfies it structurally; neither package imports the other
package postgres
type OrderRepo struct{ db *sql.DB }
func (r *OrderRepo) Save(ctx context.Context, o *order.Order) error { /* ... */ }
```

Producer-defined interfaces create import cycles and force the producer to know every use case. Consumer-defined interfaces are smaller, easier to fake, easier to satisfy with a new adapter — "accept interfaces, return structs."

### 2. A port is shaped by the core's needs, not the vendor's API
```go
// Bad — leaks SQL semantics; can't actually be swapped
type OrderStore interface {
    QueryRow(ctx context.Context, sql string, args ...any) Row
}

// Good — speaks the core's language; swappable for real
type OrderRepository interface {
    Save(ctx context.Context, o *order.Order) error
    ByID(ctx context.Context, id order.ID) (*order.Order, error)
}
```

A leaky port has the vendor's shape stamped onto it — every caller assumes that vendor's semantics, so swapping becomes a rewrite. The port was supposed to give you a choice; a leaky one has already spent it. See `references/anti-patterns.md`.

## Use cases — one package, one `UseCase` type, glue not logic
```go
package placeorder
type Command struct { CustomerID customer.ID; Items []order.Line }
type UseCase struct {
    orders   OrderRepository
    payments PaymentGateway
    newID    func() order.ID
}
func New(orders OrderRepository, payments PaymentGateway, newID func() order.ID) *UseCase {
    return &UseCase{orders: orders, payments: payments, newID: newID}
}
func (uc *UseCase) Execute(ctx context.Context, cmd Command) (*order.Order, error) {
    o, err := order.New(uc.newID(), cmd.CustomerID, cmd.Items)
    if err != nil { return nil, err }
    if err := uc.payments.Charge(ctx, cmd.CustomerID, o.Total()); err != nil { return nil, err }
    if err := uc.orders.Save(ctx, o); err != nil { return nil, err }
    return o, nil
}
```

Canonical lifecycle: load entities through SPI ports → tell entities to do the work (entities decide, the use case asks) → persist → optionally publish. If the use case decides *whether* something can happen, that rule belongs on the entity.

## Adapters

**Primary (driving):** parse → build `Command` → call use case → translate result.
```go
func (h *OrderHandler) Place(w http.ResponseWriter, r *http.Request) {
    var req placeOrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, err); return
    }
    o, err := h.place.Execute(r.Context(), toCommand(req))
    if err != nil { writeDomainError(w, err); return }
    writeJSON(w, http.StatusCreated, toResponse(o))
}
```

DTOs live in the adapter package and never reach the use case — no JSON tags, Protobuf types, or `http.Request` past this layer.

**Secondary (driven):** implement the SPI port; wrap infrastructure errors into domain errors (`sql.ErrNoRows` → `order.ErrNotFound`). Never let `pq.Error` reach the use case.

**One port, many adapters** — HTTP, gRPC, CLI, Kafka consumer, integration test can all drive the same use case simultaneously. Build it once.

## `main.go` is the composition root
```go
func main() {
    cfg := config.Load()
    db, _ := sql.Open("postgres", cfg.DatabaseURL)
    repo      := postgres.NewOrderRepo(db)
    payments  := stripe.NewGateway(cfg.StripeKey)
    placeOrder := placeorder.New(repo, payments, order.NewID)
    server := httpadapter.NewServer(httpadapter.Deps{PlaceOrder: placeOrder})
    log.Fatal(server.ListenAndServe(cfg.Addr))
}
```

Plain constructors; compiler verifies the dependency graph. Prefer `wire` (compile-time codegen) over runtime DI containers — runtime DI trades compile-time safety for magic, wrong trade for Go.

## Testing by layer
| Layer             | Test type            | Fakes / mocks?                        | Tooling note                               |
|-------------------|----------------------|---------------------------------------|--------------------------------------------|
| Domain            | Unit                 | None — pure code, no I/O              | Plain `testing`                            |
| Application       | Unit with fakes      | Hand-written in-memory fakes          | Skip mock generators; fakes read like prod |
| Primary adapter   | HTTP-level test      | Real use case if cheap, fake if not   | `httptest`                                 |
| Secondary adapter | Integration          | Real DB / broker                      | `testcontainers-go` or `dockertest`        |
| End-to-end        | A few, expensive     | Full stack                            | Smoke only; not where coverage comes from  |

- **No mocks in the domain** — if you need one, the dependency belongs in a port one layer out.
- **Hand-written fakes beat generated mocks** for use-case tests — they survive interface changes, support state assertions, and read like prod.
- **Adapter tests use the real thing** — a SQL adapter tested only against a mocked `*sql.DB` has tested nothing; same for brokers and `httptest.Server`.

A test harness is a primary adapter that drives the use case in place of HTTP — that's why the use case must be transport-agnostic.

## Common mistakes (Go-specific) — full bad/good examples in `references/anti-patterns.md`

1. **Framework types in the domain** — `gorm.Model` on entities, `gin.Context` past the handler.
2. **Leaky ports** — interfaces shaped like `*sql.DB`, `*redis.Client`, or the Kafka producer.
3. **Anemic entities** — public fields, all logic in `service.go`; invariants stop being enforceable.
4. **Premature interfaces** — `OrderService` with one `OrderServiceImpl`; add the interface when the second impl arrives.
5. **Producer-defined interfaces** — the `postgres` package exports the interface; creates cycles.
6. **Business rules in the use case** — discounts, state-machine validations belong on the entity.
7. **Adapter-to-adapter imports** — HTTP handler imports `postgres`; shared types belong in domain or app.
8. **`internal/port/` mega-package** — every interface in one bucket; grows without bound.
9. **Returning domain entities from HTTP** — `json.Encode(order)` couples API shape to entity shape; use a response DTO.
10. **`context.Context` not threaded through** — breaks cancellation, deadlines, tracing.
11. **Mocking what you don't own** — `*sql.DB`, `*http.Client`; wrap behind a port and mock the port (or use testcontainers).
12. **Cross-bounded-context imports** — `internal/orders` imports `internal/billing`; see `references/multi-bounded-context.md`.

## When NOT to use hexagonal
- **Small CLIs / one-shot scripts** — cost exceeds return.
- **Write-and-forget code** — throwaway migrations, ad-hoc data fixes.
- **Prototypes / spikes** — discover the shape first; refactor if it graduates.
- **Latency-critical hot paths** — each boundary is a small indirection; profile, don't guess.
- **Pure passthrough services** — no real domain to protect.
- **Libraries** — they're the adapter in someone else's hexagon.

Gut check: if you can't name the *second reason* a boundary exists, you don't need it yet.
