# Anti-patterns: extended treatment

Load this when reviewing code that smells off, or when you suspect a specific failure mode and want the deep treatment with examples.

The SKILL.md summary lists twelve. This file expands each with bad/good code and the underlying reasoning.

---

## 1. Framework types in the domain

**Bad:**

```go
package order

import "gorm.io/gorm"

type Order struct {
    gorm.Model                       // ← couples Order to GORM's lifecycle
    Lines  []Line  `json:"lines"`    // ← couples to one JSON shape
    Status string  `gorm:"index"`    // ← couples to GORM tags
}
```

**Good:**

```go
package order

type Order struct {
    id        ID
    placedAt  time.Time
    lines     []Line
    status    Status
}
```

**Why:** every framework annotation is a vote that the framework will outlive the business. It rarely does. Frameworks have major-version breaks every 2–3 years. When they break, you're rewriting *business code* to satisfy *framework code*. If a serialization concern needs to exist, it lives in a DTO inside the adapter, mapping to and from the clean domain type.

The translation layer feels like extra work the first day. By month six it's saved you from one framework upgrade and one ORM swap.

---

## 2. Leaky ports

**Bad:**

```go
type OrderStore interface {
    QueryRow(ctx context.Context, sql string, args ...any) Row
    Exec(ctx context.Context, sql string, args ...any) (Result, error)
}
```

```go
type Cache interface {
    Pipeline() *redis.Pipeline             // ← *redis.* leaks through
    Eval(ctx context.Context, script string, keys []string, args ...any) (any, error)
}
```

```go
type Queue interface {
    Send(ctx context.Context, msg kafka.Message) error   // ← kafka.Message in the port
}
```

**Good:**

```go
type OrderRepository interface {
    Save(ctx context.Context, o *order.Order) error
    ByID(ctx context.Context, id order.ID) (*order.Order, error)
}

type SessionCache interface {
    Get(ctx context.Context, key string) (Session, error)
    Put(ctx context.Context, key string, s Session, ttl time.Duration) error
}

type OrderPublisher interface {
    PublishOrderPlaced(ctx context.Context, e events.OrderPlaced) error
}
```

**Why:** the bad versions look like ports but have the vendor's contract baked into the method signatures. A caller written against `OrderStore` *cannot* be re-pointed at a key-value store without rewriting every call site — every consumer assumed SQL semantics, transactions, the row/exec split. A caller written against `Cache.Pipeline()` is stuck on Redis forever; you cannot satisfy `*redis.Pipeline` from Memcached.

The point of the port is to give the core a *choice* of implementation later. A leaky port has already spent that choice. Design the port for what the core needs to *accomplish*, in the core's language, before you've ever picked a vendor — and the freedom survives.

A quick check at code review: read the port out loud. If you have to say "SQL," "Redis," "Kafka," or "S3" to explain a method, the port is leaky.

---

## 3. Anemic domain

**Bad:**

```go
type Order struct {
    ID     string
    Status string
    Lines  []Line
}

// orderservice/order_service.go
func (s *OrderService) Cancel(o *Order, reason string) error {
    if o.Status == "shipped" {
        return errors.New("cannot cancel shipped")
    }
    o.Status = "cancelled"
    return nil
}
```

**Good:**

```go
type Order struct {
    id     ID
    status Status
    lines  []Line
}

func (o *Order) Cancel(reason string) error {
    if o.status == StatusShipped {
        return ErrAlreadyShipped
    }
    o.status = StatusCancelled
    return nil
}
```

**Why:** in the bad version, `Order` is a data bag. Every caller everywhere can write `o.Status = "shipped"` and put the entity into a state the business doesn't allow. The "can it be cancelled?" rule lives in `OrderService`. The "can it be refunded?" rule lives in `RefundService`. The "is it active?" rule lives in `ReportingService`. Eventually they disagree, because nothing enforces a single source of truth.

Encapsulation isn't ceremony. It's the *only* way to make invariants hold over time. Unexported fields + behavior methods make the entity responsible for its own consistency, which means the rule is in one place and can't drift.

---

## 4. Premature interfaces

**Bad:**

```go
// internal/domain/order/repository.go
type Repository interface {
    Save(ctx context.Context, o *Order) error
    ByID(ctx context.Context, id ID) (*Order, error)
}

// internal/adapter/secondary/postgres/order_repo.go
type OrderRepositoryImpl struct{ db *sql.DB }

func (r *OrderRepositoryImpl) Save(ctx context.Context, o *order.Order) error { /* ... */ }
```

There is exactly one implementation. The "Impl" suffix is a tell. The interface is in the domain package, where it doesn't belong (the domain shouldn't know about repositories).

**Good — for now, just the concrete:**

```go
// internal/adapter/secondary/postgres/order_repo.go
package postgres

type OrderRepo struct{ db *sql.DB }

func NewOrderRepo(db *sql.DB) *OrderRepo { return &OrderRepo{db: db} }

func (r *OrderRepo) Save(ctx context.Context, o *order.Order) error { /* ... */ }
```

**Good — later, when a second consumer or a fake appears:**

```go
// internal/app/placeorder/ports.go
package placeorder

type OrderRepository interface {
    Save(ctx context.Context, o *order.Order) error
}
```

**Why:** interfaces have a cost — indirection, harder navigation, more files, slower refactors. They earn that cost only when something *substitutes* through them: a fake for testing, a second implementation, a decorator. Until then they're noise.

Introduce the interface the moment you write the second implementation. Usually that's the test fake. Not before.

---

## 5. Producer-defined interfaces (the Java reflex)

**Bad:**

```go
// internal/adapter/secondary/postgres/repository.go
package postgres

type OrderRepository interface {
    Save(ctx context.Context, o *order.Order) error
}

type OrderRepo struct{ db *sql.DB }

func NewOrderRepo(db *sql.DB) OrderRepository { return &OrderRepo{db: db} }
```

**Good:**

```go
// internal/app/placeorder/ports.go
package placeorder

type OrderRepository interface {
    Save(ctx context.Context, o *order.Order) error
}

// internal/adapter/secondary/postgres/order_repo.go
package postgres

type OrderRepo struct{ db *sql.DB }

func NewOrderRepo(db *sql.DB) *OrderRepo { return &OrderRepo{db: db} }
```

**Why:** the producer pattern is a reflex from languages where interfaces must be implemented explicitly. Go's structural typing means the producer doesn't need to declare the contract. Letting the consumer declare it gives you:

- No import cycles (the producer doesn't have to import everything that wants its services).
- Smaller interfaces (each consumer asks for exactly what it needs — `placeorder.OrderRepository` may have one method while `orderhistory.OrderRepository` has three).
- Local meaning (the interface lives next to the code that explains why it exists).

Return concrete types from constructors. `*OrderRepo`, not `OrderRepository`. The consumer narrows to its own interface at the call site.

---

## 6. Business rules in the use case

**Bad:**

```go
func (uc *UseCase) Execute(ctx context.Context, cmd Command) (*order.Order, error) {
    if cmd.CustomerStatus == "suspended" {
        return nil, errors.New("suspended customers cannot order")
    }
    discount := 0.0
    if cmd.CustomerTier == "gold" { discount = 0.1 }
    if cmd.Total > 1000 { discount += 0.05 }
    finalTotal := cmd.Total * (1 - discount)
    // ...
}
```

**Good:**

```go
func (uc *UseCase) Execute(ctx context.Context, cmd Command) (*order.Order, error) {
    cust, err := uc.customers.ByID(ctx, cmd.CustomerID)
    if err != nil { return nil, err }
    o, err := order.PlaceFor(cust, cmd.Items)   // domain decides eligibility + pricing
    if err != nil { return nil, err }
    return o, uc.orders.Save(ctx, o)
}
```

**Why:** rules in the use case can't be reused by the next use case (they get re-implemented, and drift), can't be unit-tested without a use-case harness, and tend to grow into a tangled if-tree. Push the decision down into the entity or domain service that *owns* the concept. The use case orchestrates; the domain decides.

A useful test: if you can rephrase the rule as a sentence about the entity ("a suspended customer cannot place an order," "gold customers get 10% off"), the rule belongs on the entity, not in the use case.

---

## 7. Adapter-to-adapter imports

**Bad:**

```go
// internal/adapter/primary/http/order_handler.go
package http

import "myservice/internal/adapter/secondary/postgres"

type OrderHandler struct {
    place *placeorder.UseCase
}

func (h *OrderHandler) Place(w http.ResponseWriter, r *http.Request) {
    // ...
    _ = postgres.OrderRow{}  // ← HTTP knows what a Postgres row looks like
}
```

**Good:** HTTP imports the use case and the domain. Period. If two adapters need the same type, it belongs in the domain or the use case, not in either adapter.

**Why:** adapters are *peers*. They communicate only through the application/domain layers. A cross-adapter import creates a back channel that defeats the entire pattern — now swapping Postgres also breaks HTTP, because HTTP was depending on a Postgres type. The boundary is gone.

---

## 8. `internal/port/` mega-package

**Bad:**

```
internal/
└── port/
    ├── order_repository.go
    ├── customer_repository.go
    ├── payment_gateway.go
    ├── event_publisher.go
    ├── notifier.go
    └── ... 30 more
```

**Good:** ports live with the use case that owns them.

```
internal/app/
├── placeorder/
│   └── ports.go     // OrderRepository, PaymentGateway
├── cancelorder/
│   └── ports.go     // OrderRepository (different shape!), EventPublisher
└── notifycustomer/
    └── ports.go     // CustomerRepository, Notifier
```

**Why:** a central port package centralizes what should be local. It encourages producer-side thinking ("here are all our ports"). It grows without bound. It collides — every use case wants an `OrderRepository`, but they want different shapes. The collision forces a one-size-fits-all interface that suits nobody.

Keeping ports local to the use case lets each consumer name its own shape. Two `OrderRepository` interfaces in two packages with different methods is fine and good — they mean different things.

---

## 9. Returning domain entities from HTTP

**Bad:**

```go
o, err := h.place.Execute(r.Context(), cmd)
if err != nil { writeError(w, err); return }
json.NewEncoder(w).Encode(o)   // ← serializes the domain entity directly
```

**Good:**

```go
o, err := h.place.Execute(r.Context(), cmd)
if err != nil { writeError(w, err); return }
writeJSON(w, http.StatusCreated, toResponse(o))
```

```go
type orderResponse struct {
    ID         string `json:"id"`
    Status     string `json:"status"`
    TotalCents int64  `json:"total_cents"`
    Currency   string `json:"currency"`
}

func toResponse(o *order.Order) orderResponse {
    return orderResponse{
        ID: string(o.ID()),
        Status: string(o.Status()),
        TotalCents: o.Total().Cents(),
        Currency: o.Total().Currency(),
    }
}
```

**Why:** when you encode the entity directly, the wire shape and the domain shape move together. Adding a field to the entity changes the API. Renaming a field breaks clients. Removing a method that you used as a getter quietly drops a field from the response.

The 10 lines of mapping pay for themselves the first time you change the entity without wanting to change the API.

A related symptom: domain entities with `json:"..."` tags. The tags themselves are the giveaway — the domain shouldn't know it's ever going over JSON.

---

## 10. `context.Context` not threaded through

**Bad:**

```go
func (uc *UseCase) Execute(cmd Command) (*order.Order, error) {
    o, _ := uc.orders.ByID(cmd.OrderID)   // ← no ctx
    // ...
}
```

**Good:**

```go
func (uc *UseCase) Execute(ctx context.Context, cmd Command) (*order.Order, error) {
    o, err := uc.orders.ByID(ctx, cmd.OrderID)
    // ...
}
```

**Why:** cancellation, deadlines, tracing spans, and per-request values all flow through `context.Context`. A handler that gets a 500ms timeout from the load balancer can't enforce it if the use case doesn't propagate `ctx`. The first I/O call inside the use case will happily block past the timeout, returning a result the client has already given up on.

`ctx context.Context` is the first parameter of every method that does I/O or might. No exceptions.

The other reason: tracing. Distributed tracing relies on `ctx` carrying the span. If you drop it, the trace breaks at that boundary, and you find out only when you're trying to debug a production incident.

---

## 11. Mocking what you don't own

**Bad:**

```go
func TestPlaceOrder(t *testing.T) {
    mockDB := mockSQL.NewMockDB(t)
    mockDB.EXPECT().Exec(gomock.Any(), gomock.Any()).Return(...)
    repo := postgres.NewOrderRepo(mockDB)
    // ...
}
```

**Good (option A — fake the port):**

```go
type fakeOrderRepo struct{ saved []*order.Order }
func (f *fakeOrderRepo) Save(_ context.Context, o *order.Order) error {
    f.saved = append(f.saved, o); return nil
}

func TestPlaceOrder(t *testing.T) {
    repo := &fakeOrderRepo{}
    uc := placeorder.New(repo, ...)
    // test the use case, not the adapter
}
```

**Good (option B — real DB for adapter tests):**

```go
func TestOrderRepo_Save(t *testing.T) {
    db := startPostgres(t)              // testcontainers
    repo := postgres.NewOrderRepo(db)
    err := repo.Save(ctx, makeOrder())
    require.NoError(t, err)
    // assert by reading back from the real DB
}
```

**Why:** you don't control `*sql.DB`'s API. Your mock encodes assumptions — "this Exec returns nil" — that the real driver might violate in edge cases (deadlocks, connection drops, prepared-statement caching). The test passes; production breaks.

The general rule: **mock the boundaries you own, use real implementations for boundaries you don't.** Wrap third-party clients behind a port you define, and either mock the port or use a real instance via testcontainers.

---

## 12. Cross-bounded-context imports

**Bad:**

```go
// internal/orders/app/placeorder/usecase.go
package placeorder

import "myservice/internal/billing/app/chargecustomer"   // ← reaches across BCs

func (uc *UseCase) Execute(ctx context.Context, cmd Command) error {
    // ...
    return uc.billing.Execute(ctx, chargecustomer.Command{ ... })
}
```

**Good:**

```go
// internal/orders/app/placeorder/usecase.go — publishes an event
func (uc *UseCase) Execute(ctx context.Context, cmd Command) error {
    // ...
    return uc.events.Publish(ctx, events.OrderPlaced{ ... })
}

// internal/billing/adapter/primary/eventconsumer/order_placed_consumer.go — subscribes
func (c *OrderPlacedConsumer) Handle(ctx context.Context, evt events.OrderPlaced) error {
    return c.charge.Execute(ctx, chargecustomer.Command{ ... })
}
```

**Why:** importing across bounded contexts collapses the boundary. Now:

- The two contexts share a release cycle (you can't deploy one without the other).
- A rename in `billing` breaks `orders`'s build.
- You can't test `orders` without `billing`'s dependencies wired.
- Extracting `billing` into its own service later becomes a migration project.

Communicate across contexts through events or a tiny shared kernel, never through direct imports. See `multi-bounded-context.md` for the full layout.

---

## Quick review checklist

When reviewing a hexagonal Go PR, scan for these in order — they catch most of the damage:

1. Any `gorm`, `json`, `xml`, `gin`, `echo` import inside `internal/domain/...`? → mistake #1.
2. Any SPI port method that names a vendor type (`*sql.Tx`, `*redis.Client`, `kafka.Message`, `*http.Client`)? → mistake #2.
3. Any entity with all-public fields and no methods? → mistake #3.
4. Any `Impl`-suffixed type, or any interface with one implementation and no fake? → mistake #4.
5. Any interface declared in an adapter package and imported from outside? → mistake #5.
6. Any `if` in a use case checking domain state ("is suspended," "is active," "is gold tier")? → mistake #6.
7. Any adapter package importing another adapter package? → mistake #7.
8. Any `internal/port/` or `internal/interfaces/` package? → mistake #8.
9. Any `json.Encode(entity)` in a handler? → mistake #9.
10. Any method doing I/O without `ctx context.Context` as the first param? → mistake #10.
11. Any test that mocks a third-party API directly? → mistake #11.
12. Any cross-`internal/<bc>/` import? → mistake #12.

If all twelve pass, the hexagon is intact.
