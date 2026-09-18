# Events and CQRS

Load this when designing event-driven flows in a hexagonal Go service, or when you're feeling read/write scaling pressure and considering CQRS.

---

## Domain events vs application events

Two distinct concepts. Confusing them creates a mess.

### Domain events

Live in the **domain layer**. Record that *something meaningful happened to an entity* in business terms: `OrderPlaced`, `PaymentFailed`, `CustomerSuspended`. Part of the domain's vocabulary. No transport, no serialization, no infrastructure.

```go
// internal/domain/order/events.go
package order

type OrderPlaced struct {
    OrderID    ID
    CustomerID customer.ID
    Total      Money
    PlacedAt   time.Time
}
```

Entities or domain services produce them — typically as a side effect of a state-changing method:

```go
func (o *Order) Place() OrderPlaced {
    o.status = StatusPlaced
    o.placedAt = time.Now().UTC()
    return OrderPlaced{
        OrderID:    o.id,
        CustomerID: o.customerID,
        Total:      o.Total(),
        PlacedAt:   o.placedAt,
    }
}
```

Or accumulated on the entity for the use case to drain:

```go
func (o *Order) Cancel(reason string) error {
    if o.status == StatusShipped { return ErrAlreadyShipped }
    o.status = StatusCancelled
    o.events = append(o.events, OrderCancelled{OrderID: o.id, Reason: reason})
    return nil
}

func (o *Order) PullEvents() []DomainEvent {
    events := o.events
    o.events = nil
    return events
}
```

Either shape works. The accumulator version is cleaner when one method produces multiple events or when events need to be transactional with persistence.

### Application events

A domain event *after* it's been promoted to a cross-component or cross-service concern. Has transport (a message bus, a Kafka topic, an SQS queue, an in-process dispatcher). The boundary signal that says "this happened; if anyone outside the use case cares, react now."

The use case is responsible for the promotion. The domain doesn't know application events exist.

### The lifecycle

```
1. Entity records a domain event during o.Cancel("...").
2. Use case finishes the unit of work.
3. Use case pulls events off the entity (or collects the returned event).
4. Use case hands them to an EventPublisher SPI port.
5. The application-event adapter publishes them
   (in-process dispatcher / Kafka / NATS / SQS / etc.).
6. Other components or services subscribe via their own primary adapters and react.
```

```go
// internal/app/cancelorder/ports.go
package cancelorder

type EventPublisher interface {
    Publish(ctx context.Context, events []order.DomainEvent) error
}
```

```go
// internal/app/cancelorder/usecase.go
func (uc *UseCase) Execute(ctx context.Context, cmd Command) error {
    o, err := uc.orders.ByID(ctx, cmd.OrderID)
    if err != nil { return err }
    if err := o.Cancel(cmd.Reason); err != nil { return err }
    if err := uc.orders.Save(ctx, o); err != nil { return err }
    return uc.events.Publish(ctx, o.PullEvents())
}
```

### Why split the two

- The **domain event** is what *happened* in business terms — pure data, no transport.
- The **application event** is the *delivery* of that fact to the outside world.

Splitting them means: the domain doesn't know Kafka exists, the entity is unit-testable in microseconds, and the choice of broker is just an adapter swap. Picking up a different broker, or switching from in-process pub/sub to a real bus, requires zero domain or use-case changes.

### Transactional concerns: the outbox

If you persist the entity and publish the event in two separate calls (DB then broker), you can lose the event mid-flow. The standard fix is the **transactional outbox**: write the event to an `outbox` table inside the same DB transaction as the entity mutation, then have a separate process drain the outbox into the broker.

The use case doesn't know this is happening — it calls `events.Publish(...)` as usual. The `EventPublisher` adapter for production writes to the outbox; the outbox-relay process is a separate adapter (or a separate small service) that handles the publish.

This is invisible to the domain, the use case, and most of the codebase. It just becomes how `EventPublisher` is wired in `main.go`.

---

## CQRS as an optional shape

CQRS (Command Query Responsibility Segregation) is what you get when you split a single use case into a **command handler** (mutations) and a **query handler** (reads), often routed through a command bus / query bus. It sits naturally on top of hexagonal.

### The shape in Go

```
internal/app/
├── command/
│   ├── placeorder/
│   │   └── handler.go     // writes via the domain
│   └── cancelorder/
│       └── handler.go
└── query/
    ├── orderdetails/
    │   └── handler.go     // reads from a denormalized view
    └── orderhistory/
        └── handler.go
```

- **Commands** flow through the full hexagon: handler → use case → domain → repository. The domain is the authority on writes.
- **Queries** often bypass the domain entirely and read denormalized views directly. The domain doesn't need to validate a read.

Optionally introduce a `CommandBus` / `QueryBus` to dispatch by type. Useful when you have many of each and want middleware (logging, auth, metrics) in one place. Not required.

```go
type CommandBus interface {
    Dispatch(ctx context.Context, cmd any) (any, error)
}
```

### When CQRS pays off

- Reads and writes have **very different scaling profiles** (e.g. 1000:1 read:write ratio).
- You want to **evolve them independently** — change the read model without touching the write model, or vice versa.
- You're building a **reporting / search** view over the same domain and the denormalization is enough work to justify a separate handler.
- You want **eventual consistency** between writes and reads (write to one store, project into another).

### When CQRS is overkill

- Plain CRUD with no scaling pressure.
- Reads and writes have similar volume.
- The team is small and the cost of two handler types per operation isn't paying back yet.

For most Go services, plain hexagonal (without CQRS) is enough. Add CQRS when you feel the pressure, not before.

### Migration path

If you build with a single `UseCase` per operation today and decide you need CQRS later, the migration is mechanical:

1. Rename `UseCase` → `Handler` in the command-shaped operations.
2. Extract the read paths into separate `Query` handlers — possibly bypassing the domain.
3. Introduce a `CommandBus` / `QueryBus` if you want centralized middleware.

The domain doesn't change. The adapters don't change. Only the application layer's shape shifts.

A useful pre-emptive seam: if you suspect CQRS is in your future, put each operation in its own package (`internal/app/placeorder/`) rather than grouping related ones in a single package. That makes the eventual split cleaner.

---

## Common mistakes around events and CQRS

- **Publishing before persisting.** Use case publishes the event, then the DB save fails. Now downstream consumers think something happened that didn't. Always persist first, then publish — or use an outbox.
- **Domain importing the event publisher.** The entity calls `bus.Publish(...)` directly. Now the domain depends on infrastructure. Keep publishing in the use case.
- **Cross-context call dressed as an event.** `OrderPlaced` published with a payload that's essentially "please charge the customer $50 right now and tell me synchronously if it worked." That's an RPC, not an event. Events are facts, not requests.
- **Premature CQRS.** Splitting reads and writes when there's no scaling pressure and no query that needs a different model. You've doubled the surface for no payback.
- **Anemic event payloads.** `OrderPlaced{ID: "..."}` — now every consumer has to call back to fetch the rest. Either put the data the typical consumer needs in the event, or accept the extra round-trip as a design choice (and not an accident).
