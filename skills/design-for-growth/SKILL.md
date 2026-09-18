---
name: design-for-growth
description: Opt-in skill for projects that will grow a lot and must not change architecture later. Build the extensible architecture on day one, so later features add files instead of rewrite them. Use only when the user opts in with "design for growth", "overengineer from the start", "build for scale from day one", "this will grow a lot", "long-lived project", "arsitektur jangan banyak berubah", or "akan banyak pengembangan", or when a project AGENTS.md names this skill. Covers architectural seams, ports and adapters, registries, typed config, a single composition root, versioned data contracts, domain errors, observability, fakes and contract tests, feature-first layout, and lifecycle. Not a default. Skip when the user did not opt in.
---

# Design for Growth

Invest in architectural seams up front. Growth then goes into the seams, not into the features.

A seam is a boundary you can extend later without an edit to existing code. A feature is behavior a user asks for. This skill tells you to build seams early and to build features late. A new provider, a new output format, or a new storage backend must arrive as a new file behind an existing seam.

Apply this skill only when the user opts in. It is not a default.

---

## Precedence

When this skill is loaded it overrides two rules, for architectural seams only.

1. It overrides `clean-code-standard` §5 "Rule of three: duplicate once tolerate, twice extract". Under this skill, a seam with one implementation today is correct when a second implementation is plausible.
2. It overrides the global scope rule "no extra abstractions". Under this skill, seams are in scope. Extra *features* stay out of scope. The user asks for features. The architecture anticipates them.

Everything else in `clean-code-standard` and the global scope rule still applies.

---

## Seam vs feature

| Build now (seam) | Wait for the ask (feature) |
|---|---|
| A provider interface with one adapter | A second provider |
| A registry keyed by name | The second registered entry |
| A typed config object | A config value nobody reads |
| A versioned serialized shape | A migration for a version that does not exist |
| A domain error base class | An error subclass nobody raises |
| Lifecycle start and stop hooks | Graceful-shutdown tuning |
| One package per bounded context | A second bounded context |

---

## Boundaries

**Do**
- Keep the domain core free of framework and vendor imports.
- Define each port on the consumer side, next to the code that calls it.
- Give each package one public entry point.
- Point every dependency inward, toward the domain.

**Don't**
- Import a driver, SDK, or HTTP client type inside the domain.
- Define a port in the adapter package that implements it.

---

## Extension points

**Do**
- Dispatch through a registry or plugin map keyed by name.
- Define a strategy interface for anything with more than one plausible implementation.
- Treat LLM provider, storage backend, tool backend, transport, and output format as strategies.
- Add new behavior as a new file that registers itself.

**Don't**
- Branch on a type string with `if`/`elif` inside a dispatcher.
- Edit the dispatcher for each new variant.
- Abstract a thing with exactly one plausible implementation and no roadmap item.

---

## Configuration

**Do**
- Build one typed config object at the composition root.
- Inject the config object into each component that needs it.
- Put a version field on the settings shape.

**Don't**
- Read an environment variable outside the composition root.
- Pass a raw dict or map where a typed object fits.

---

## Composition root

**Do**
- Wire the whole application in one file.
- Construct each component with a plain constructor.
- Pass every dependency as an argument.

**Don't**
- Use a global, a module-level singleton, or a service locator.
- Construct an adapter inside the domain.

---

## Data contracts

**Do**
- Declare a typed schema at every boundary: pydantic model, dataclass, TypeScript type, or struct.
- Put a version field on every persisted or serialized shape.
- Reserve an explicit module for migration code, even when it is empty.

**Don't**
- Accept an untyped payload past the boundary.
- Persist a shape with no version field.

---

## Errors

**Do**
- Define one domain error base type in the first commit.
- Derive each domain error from that base type.
- Translate a vendor error into a domain error inside the adapter.

**Don't**
- Let a vendor exception type reach the domain or the caller.
- Raise a bare built-in error from domain code.

---

## Observability

**Do**
- Emit structured logs from the first commit.
- Attach a correlation ID to every request path.
- Follow the `create-proper-logging` skill for format, levels, and redaction.

**Don't**
- Print to standard output as a log.

---

## Testing

**Do**
- Write a fake for every port. The fake proves the seam is real.
- Write one contract test per port. Run it against the fake and against each real adapter.
- Follow the `test-driven-development` skill for the cycle and the sweep size.

**Don't**
- Mock a vendor SDK where a fake port fits.
- Ship a port with no fake.

---

## Layout and docs

**Do**
- Group packages by feature, not by technical layer.
- Split by bounded context even when only one context exists today.
- Write an `ARCHITECTURE.md` that names each seam and the growth path it enables.

**Don't**
- Create a `Manager`, `Helper`, or `Util` package or class.
- Add a pass-through layer with no behavior.

---

## Lifecycle

**Do**
- Give each long-running component an explicit start and stop.
- Propagate cancellation through every long-running path.
- Close resources in reverse order of open.

**Don't**
- Start a background task with no way to stop it.
- Leave a resource open at shutdown.

---

## Planner checklist

Apply this when `comprehensive-planning` runs with this skill loaded.

- §5 Approach names every seam and the second implementation each seam anticipates.
- §6 File tree shows the composition root.
- §6 File tree shows one adapter directory per port.
- §10 Risks lists each speculative seam and its cost.

---

## Reviewer checklist

- Each seam has a fake.
- Each adapter has a contract test.
- The domain imports no vendor package.
- No dispatcher switches on a type string.
- Config is read only at the composition root.
- Every serialized shape carries a version field.
- `ARCHITECTURE.md` lists each seam.

---

## References

- [references/seam-catalog.md](references/seam-catalog.md) — the seams that usually pay off, grouped by project kind, with the second implementation each one anticipates. Read when you choose which seams to build for a new project, or when you review a plan for missing seams.
