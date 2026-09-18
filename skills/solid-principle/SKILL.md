---
name: solid-principle
description: Apply SOLID principles when designing or reviewing classes, modules, interfaces, and dependency direction. Reach for a principle when a seam is actually stressed — not as a rote checklist. Use when the user mentions SOLID, single responsibility, open/closed, Liskov, interface segregation, or dependency inversion.
---

# SOLID Principles

Principles are tools for when a seam is actually being stressed — not a checklist to satisfy on every class.

---

## S — Single Responsibility

**Do**
- Give a class one reason to change; align it to one stakeholder or concern.
- Split a class when two unrelated stakeholders frequently edit it for different reasons.
- Name classes after what they own, not a grab-bag like `Manager` or `Helper`.

**Don't**
- Bundle persistence, business logic, and formatting in the same type.
- Let a class serve two masters; pick one and extract the other.
- Create a "god object" that knows everything and does everything.

---

## O — Open/Closed

**Do**
- Add new behavior by introducing new types, strategies, or handlers.
- Reach for this principle when a `switch`/`if-else` chain keeps growing with every release.
- Expose stable extension points (interfaces, hooks, plugins) instead of editing core logic.

**Don't**
- Edit the same conditional block for every new variant or case.
- Scatter new-feature logic across an existing class's internals.
- Conflate "closed to modification" with "frozen forever" — refactoring is still valid.

---

## L — Liskov Substitution

**Do**
- Honor the supertype's contract in every subtype: same preconditions, same postconditions.
- Ensure a subtype can stand in wherever the supertype is expected without surprises.
- Prefer composition over inheritance when the subtype can't fully honor the contract.

**Don't**
- Override a method to throw `NotSupportedException` or `NotImplementedException`.
- Strengthen what callers must provide (narrower preconditions) in a subtype.
- Widen what callers must tolerate (looser postconditions) in a subtype.

---

## I — Interface Segregation

**Do**
- Define small, focused interfaces aligned to what each consumer actually calls.
- Split a fat interface by consumer role when implementers only need a subset.
- Let consumers own the interface; define it where it is used, not where it is implemented.

**Don't**
- Force implementers to stub or no-op methods they don't use.
- Grow a single interface because it is "related" in some abstract sense.
- Couple unrelated consumers through a shared interface they only partially need.

---

## D — Dependency Inversion

**Do**
- Define abstractions (interfaces/ports) on the consumer/domain side, not the infrastructure side.
- Make high-level policy depend on abstractions it owns; have infrastructure implement them.
- Point dependencies inward toward the domain — infrastructure imports domain, never the reverse.

**Don't**
- Import concrete infrastructure types (DB drivers, HTTP clients, file paths) directly in domain logic.
- Let the domain know which database, queue, or framework is in use.
- Place interfaces in the infrastructure layer and make the domain reach out to them.
