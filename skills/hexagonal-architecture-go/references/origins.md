# Origins & terminology

Load this when discussing the pattern with reviewers who reach for canonical vocabulary, or when justifying a design choice in writing.

## Cockburn, 2005

Alistair Cockburn coined the pattern to "avoid known structural pitfalls in object-oriented software design, such as undesired dependencies between layers and contamination of user interface code with business logic."

He later renamed it from **Hexagonal Architecture** to **Ports and Adapters** to clarify intent — the original name implied geometry; the new one names the parts.

You will see both names in the wild. They refer to the same thing.

## The hexagon is not six sides

Cockburn explicitly said the shape "was not to suggest that there would be six borders/ports, but to leave enough space to represent the different interfaces needed between the component and the external world."

A real service has as many ports as it has reasons to talk to the outside. Two, ten, twenty — the count doesn't matter and never did. If anyone tells you "you have too many ports for a hexagon," they've misread the metaphor.

## API ports vs SPI ports

The vocabulary from the patterns literature:

- **API (Application Programming Interface) port** — a *driving / primary* port. The outside calls in. In Go, this is usually just the public method of a use case; you rarely need a named interface for it.
- **SPI (Service Provider Interface) port** — a *driven / secondary* port. The inside calls out. In Go, an interface declared by the use case for a thing it needs (a repository, a publisher, a clock).

Three names for the same axis, all valid:
- driving / driven
- primary / secondary
- API / SPI

Use whichever the reviewer prefers; they all map cleanly.

## Configurable dependencies (Cockburn's framing)

The mental model Cockburn used: everything that *can change* for reasons unrelated to the business (the database, the transport, the queue, the clock, the random source) should be a *configurable dependency* of the core. The core stays put; the things it talks to are swappable. Ports and adapters operationalize that — the port declares the dependency, the adapter supplies it.

## Onion vs Clean vs Hexagonal

Cousins, not synonyms. They share the dependency-inversion spirit but differ in what they prescribe.

| Pattern        | Year | Author      | Prescription |
|----------------|------|-------------|--------------|
| Hexagonal      | 2005 | Cockburn    | Isolate the core behind ports + adapters. Silent on the core's internal structure. |
| Onion          | 2008 | Palermo     | Adds: split the core into domain model + domain services; the application layer (not the domain) talks to repositories. |
| Clean          | 2012 | Martin      | Generalizes the family (hexagonal + onion + BCE + DCI). Bakes in the Dependency Inversion Principle as the unifying rule. Adds the entities/use-cases/interface-adapters/frameworks ring vocabulary. |

In practice, most modern Go services that call themselves "hexagonal" are doing a blend: **hexagonal on the outside** (ports/adapters at the boundary), **onion/DDD on the inside** (domain ↔ application split). That's what this skill teaches.

## One port, many adapters

A single API port — say, `PlaceOrder` — can be driven by an HTTP handler, a gRPC handler, a CLI, a Kafka consumer, and an integration test, all at the same time. That's the payoff. Build the use case once; expose it through whichever adapter the situation calls for.

## A known critique (Fowler)

Martin Fowler points out that the symmetric hexagon hides the "inherent asymmetry between a service provider and a service consumer."

It's worth knowing the critique: the model is a simplification. Driving and driven ports have very different shapes and lifecycles. Pretending they're symmetric can mislead — for example, you don't usually need a named Go interface for a driving port (the use case's method set *is* the port), but you almost always need one for a driven port. Treat them as related but distinct categories, not mirrors.

## How to talk about it in review

- Don't argue about whether "hexagonal" and "ports and adapters" are different. They aren't.
- Don't argue about the number of sides. There aren't sides.
- Don't conflate "Clean Architecture" with hexagonal. Clean is the generalization; hexagonal is one of its sources.
- Do use **API/SPI** when you want precision about port direction — it avoids the confusion that "primary" and "secondary" sometimes cause for newcomers ("which one is more important?").
- Do reference Cockburn's *configurable dependencies* framing when defending a port that looks like overkill today but exists to make tomorrow's swap cheap.
