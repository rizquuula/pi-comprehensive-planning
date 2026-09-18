---
name: test-driven-development
description: Apply when writing tests or production code test-first; red-green-refactor cycles; scaling the test sweep to the change size (bug fix vs feature slice vs new subsystem); and end-to-end proof of critical journeys. Use when the user mentions test-driven development, test-first, red-green, unit/integration/e2e testing, test strategy, or coverage.
---

# Test-Driven Development

Tests before code, prove end-to-end after; scale the sweep to the slice — don't write all tests up front (big design up front in a test-first costume) nor one-test-at-a-time for a whole feature (erodes design benefit).

---

## Red-green-refactor

**Do**
- Write a failing test first and **see it fail** — red proves the test actually tests something.
- Make it pass with the simplest code that works (green).
- Refactor only under a green bar; tests are your safety net during cleanup.
- Commit at green before refactoring so you have a rollback point.

**Don't**
- Write tests after the code — that's verification, not test-driven development.
- Skip the red step; a test that was never red may never catch a regression.
- Refactor while tests are red — you lose signal on what broke.

---

## Scale the sweep to the change

**Do**
- **Bug fix** — write one red test that reproduces the exact failure, then fix.
- **Single feature / slice** — write the full behavioral test suite for the slice first (see the design before code biases you), then implement.
- **New subsystem** — test suite per slice, implement slice by slice, then add e2e coverage across slices.
- Let the size of the change dictate how many tests you write before coding.

**Don't**
- Write tests for an entire subsystem up front before any implementation (BDUF).
- Drip one test at a time across a whole feature — you lose the design benefit of seeing the full behavioral picture early.
- Use a bug-fix sweep (one test) for a feature-sized change — the design signal evaporates.

---

## What and how to test

**Do**
- Test behavior through public surfaces, not internal wiring.
- One behavior per test; name tests in domain language (`order_placed_reserves_stock`).
- Mock infrastructure only — clocks, IO, network, queues; let the domain run real.
- Use test-data builders to construct meaningful fixtures: `aPlacedOrder()`, `aUser().withRole("admin")`.
- Keep tests deterministic; seed randomness and freeze time explicitly.

**Don't**
- Test private methods — if you feel the urge, the design is signaling a missing concept.
- Assert on multiple behaviors in one test — failures become ambiguous.
- Mock domain objects or services — mocks that stay green while the system is broken are the worst kind of false confidence.
- Write mock-heavy tests with no real logic exercised.
- Chase a coverage percentage as a goal; coverage is a smell detector, not a target.
- Test the framework or language runtime.

---

## End-to-end proof

**Do**
- After unit/module tests are green, cover critical journeys from the outermost boundary (HTTP handler, UI, CLI) through to persistent effects (DB row written, event emitted).
- Treat e2e tests as proof of wiring, not logic — logic lives in unit tests.
- Identify the 3-5 journeys where failure would be catastrophic and prioritize those.
- Run e2e against a real (or realistic) environment, not mocks.

**Don't**
- Rely on an e2e-only strategy — slow feedback, hard to diagnose, expensive to maintain.
- Skip e2e on critical journeys because unit tests "already cover it" — wiring bugs are real.
- Duplicate unit-level logic coverage in slow e2e tests; one happy path per journey is enough.
- Let e2e tests become the primary regression suite — that is a test-pyramid inversion.
