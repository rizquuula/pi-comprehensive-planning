# Multi-bounded-context layout

Load this when one Go service genuinely hosts more than one bounded context (e.g. orders + billing + auth in one binary), or you can see that day coming.

## The shape

Switch from package-by-layer to **package-by-component**: a vertical slice per bounded context, each containing its own hexagon.

```
myservice/
├── cmd/myservice/main.go
└── internal/
    ├── orders/                   # bounded context #1
    │   ├── domain/
    │   ├── app/
    │   └── adapter/
    ├── billing/                  # bounded context #2
    │   ├── domain/
    │   ├── app/
    │   └── adapter/
    ├── auth/
    │   ├── domain/
    │   ├── app/
    │   └── adapter/
    └── shared/                   # Shared Kernel — kept tiny on purpose
        ├── events/               # cross-context event types
        └── ids/                  # shared ID types
```

Each context is internally laid out exactly like a single-BC service. Inside the context, the hexagon rules are unchanged.

## The hard rule: no cross-context imports

Components **do not directly call each other's code — not even through interfaces.** `internal/orders` does not import `internal/billing`. Ever.

If `orders` needs to tell `billing` something, it does so via one of three mechanisms, in order of preference:

1. **Events (preferred).** `orders` publishes `OrderPlaced`; `billing` subscribes. Loose, async-friendly, traceable, naturally extracted to a real message bus later.
2. **A thin shared-kernel contract.** A tiny package both contexts import — event types, shared ID types, no logic. Keep it small on purpose; every type you add couples the two contexts at compile time.
3. **A discovery / mediator service.** Only when events don't fit (typically for synchronous request/response that genuinely can't be an event). Lives in `shared/` or a coordinator package neither context owns.

## Why so strict

If `orders` imports `billing.ChargeCustomer`, you've collapsed the bounded context. The two now share:

- a release cycle (you can't deploy one without the other),
- a refactor blast radius (renaming a type in `billing` breaks `orders`'s build),
- a test surface (you can't test `orders` without `billing`'s deps available),
- an extraction cost (the day you want to split `billing` into its own service is the day you discover how deep the coupling goes).

Treating contexts as separate from day one makes that extraction nearly free. If `orders` only knows `billing` via `OrderPlaced` → handler-in-billing, extracting `billing` is a config change: swap the in-process dispatcher for a real broker, point `billing` at a separate database, run it as its own binary. Zero business-code changes.

## Communicating via events: the shape

The event type lives in `shared/events/` (or `shared/contracts/`) so both contexts can refer to it. Producer and consumer each have their own adapter.

```go
// internal/shared/events/order_placed.go
package events

type OrderPlaced struct {
    OrderID    string
    CustomerID string
    TotalCents int64
    Currency   string
    PlacedAt   time.Time
}
```

```go
// internal/orders/app/placeorder/ports.go
package placeorder

type EventPublisher interface {
    Publish(ctx context.Context, evt events.OrderPlaced) error
}
```

```go
// internal/billing/adapter/primary/eventconsumer/order_placed_consumer.go
package eventconsumer

type OrderPlacedConsumer struct {
    charge *chargecustomer.UseCase
}

func (c *OrderPlacedConsumer) Handle(ctx context.Context, evt events.OrderPlaced) error {
    return c.charge.Execute(ctx, chargecustomer.Command{
        CustomerID: customer.ID(evt.CustomerID),
        AmountCents: evt.TotalCents,
        Currency: evt.Currency,
    })
}
```

The consumer is just a primary adapter for `billing` — the same shape as an HTTP handler, but driven by an event instead of a request. The in-process dispatcher wires them up in `main.go`. The day you go async, you replace the dispatcher with a Kafka adapter and the use cases never know.

## What goes in `shared/`

- **Event types** — cross-context contracts, plain data.
- **Shared IDs** — `customer.ID`, `order.ID` if multiple contexts genuinely need to reference them by value. Often these are just `type ID string` and live in `shared/ids/`.
- **Nothing else.** No "utilities," no "common services," no logging wrappers, no validators. The shared kernel must be tiny — every type in it is a compile-time coupling between contexts.

A useful test: if removing a type from `shared/` would break a build in two or more contexts, it earns its place. If it'd only break one, it doesn't belong there.

## When to actually split into separate services

You don't need separate services to get the architectural benefit. The multi-BC monolith above gives you most of it at a fraction of the operational cost. Split only when:

- The contexts have genuinely different **scaling profiles** (one is read-heavy, the other write-heavy).
- The contexts have different **ownership boundaries** (different teams, different release cadences).
- The contexts have different **availability requirements** (one is critical, the other tolerates downtime).
- The deployment is hitting concrete limits (binary size, startup time, blast radius).

Until then, keep the contexts in one binary with hard internal boundaries. You get the design benefit of microservices without the operational tax.

## Migrating from single-BC to multi-BC

Common path: you started with `internal/domain/orders/`, `internal/domain/billing/` in one shared `internal/domain/` namespace. Now they've grown apart. The refactor:

1. Pick the cleaner boundary. Probably `billing` (smaller, fewer entry points).
2. Move `internal/domain/billing/` to `internal/billing/domain/`.
3. Move the related use cases from `internal/app/` to `internal/billing/app/`.
4. Move the related adapters to `internal/billing/adapter/`.
5. Find every import from `internal/orders/...` (or its current location) into `internal/billing/...` — that's your coupling list.
6. For each coupling, replace with an event or move the type into `shared/`.
7. Verify the build still compiles with no cross-context imports.

Do it one context at a time; don't attempt a big-bang reshuffle.

## Common mistake: shared-kernel sprawl

The `shared/` package starts small. Then someone adds a "Money" type. Then a logger. Then a validator. Then a half-dozen "common" use cases. Six months later, it's the biggest package in the codebase and every context depends on it.

When `shared/` exceeds maybe 10–20 files, it's no longer a kernel — it's a god package. Push types back into the contexts that actually need them. If two contexts need the same logic, that's often a sign there's a third context hiding (a billing-platform, a notifications, etc.) that should be its own component, not a shared utility.
