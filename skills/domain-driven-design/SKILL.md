---
name: domain-driven-design
description: Apply when designing or reviewing backend domain models, layering, or naming — bounded contexts, aggregates, entities, value objects, domain events, repositories, ubiquitous language. Use when the user mentions domain-driven design, bounded contexts, aggregates, anemic models, or domain modeling for new features, subsystems, or greenfield work. Skip for one-line fixes or thin CRUD services.
---

# Domain-Driven Design

Infrastructure serves the domain. Model the domain as the experts speak it. Apply where the domain is real and behavior-rich; skip for thin CRUD (name the skip explicitly in design docs).

---

## 1. Dependency Direction & Layering

**Do**
- Keep dependency direction: `domain ← application ← infrastructure ← interface`
- Domain layer depends on nothing outside itself (no ORMs, no HTTP, no framework)
- Define repositories as interfaces inside the domain; put implementations in infra
- Application services orchestrate use cases only — call domain, coordinate infra adapters

**Don't**
- Put ORM entities or DB types in the domain layer
- Use the DB schema as the domain model
- Put business rules or decisions in application services

---

## 2. Strategic Design

**Do**
- Use ubiquitous language — the exact words domain experts use, in code
- Split bounded contexts on meaning and responsibility, not on tech boundaries
- Name context-map relationships explicitly (`Conformist`, `Customer/Supplier`, `Partnership`, `ACL`)
- Translate at external boundaries using an Anti-Corruption Layer (ACL)

**Don't**
- Let one model span unrelated contexts (a `User` in Billing ≠ `User` in Identity)
- Leak external vendor or upstream models into the domain core

---

## 3. Tactical Building Blocks

**Do**
- **Entities**: identity matters across state changes; identity is domain-meaningful (not just a DB surrogate)
- **Value Objects**: immutable, equality by attributes — prefer aggressively (`Money`, `EmailAddress`, `CustomerId`)
- **Aggregates**: consistency boundaries — one operation touches one aggregate; keep aggregates small
- **Domain Events**: past-tense in ubiquitous language (`OrderPlaced`, `PaymentFailed`, `FlightDeparted`)
- **Domain Services**: only when an operation naturally fits no entity or value object

**Don't**
- Build anemic models — data bags with all logic living in external service classes
- Create giant `OrderService`, `UserService` catch-all classes
- Design CRUD APIs for inherently behavioral domains
- Use primitives where types carry meaning (primitive obsession)

```ts
// Anemic — intent hidden, type unsafe
function transfer(fromId: string, toId: string, amount: number): void

// Domain-first — intent clear, types enforce correctness
function transfer(from: AccountId, to: AccountId, amount: Money): TransferExecuted
```

---

## 4. Domain-First Naming & Modeling

**Do**
- Name methods as the domain speaks: `flight.beginBoarding()`, `order.place()`, `policy.renew()`
- Prefer lifecycle verbs over state setters; method call should reveal intent
- Use types that tell the story — `CustomerId` and `ProductId` are not interchangeable
- Model recurring invisible nouns the domain cares about: `SchedulingWindow`, `RiskBand`, `CreditLimit`
- Shape modules after the domain narrative, not after technical layers
- Protect the metaphor: a cancelled order can't silently be "re-placed" via a flag flip

**Don't**
- Write `setStatus("PLACED")`-style intent-hiding setters
- Name things `Manager`, `Helper`, `Util`, `Processor` without a domain noun anchoring them
- Let pagination, caching, or serialization concerns dictate the domain API shape
- Invent abstractions the domain hasn't asked for — if you can't name the second caller, don't build it

```ts
// Intent hidden — caller must know the valid state string
order.setStatus("PLACED")

// Intent clear — method enforces invariants, emits OrderPlaced, checks inventory
order.place()
```
