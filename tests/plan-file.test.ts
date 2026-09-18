import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSections, planTodos, validatePlan, type PlanFile } from "../extensions/plan-file.ts";

function planFrom(raw: string): PlanFile {
  return { path: "PLAN.md", raw, sections: parseSections(raw) };
}

const GOOD = `# Plan: cache the user graph

### 1. Goal
The profile screen stops re-fetching the graph on every open.

**1a. Success criteria (testable).**
\`Profile page p95 load time <= 300ms\` · verified by the new \`profile_load_p95\` benchmark.

### 2. Non-goals
Not touching the write path.

### 6. Files to change
\`\`\`
src/
  data/cache/UserGraphCache.kt   [NEW]   in-memory cache, 5 minute expiry
  data/repository/UserRepository.kt [EDIT] reads the cache first
\`\`\`

### 7. Flow diagram
\`\`\`
  ProfileScreen
        |
        v
  +----------------+   1. look up   +------------------+
  | UserRepository |--------------->| UserGraphCache * |
  +----------------+<---------------|                  |
        |               2. hit      +------------------+
        | 3. miss
        v
  +----------------+
  | GraphApi (net) |
  +----------------+
\`\`\`

### 8. Step-by-step breakdown (test-first)
| # | Red: write the failing test | Green: make it pass | Refactor | Done when |
|---|---|---|---|---|
| 1 | \`UserGraphCacheTest.kt\` — hit, miss, expiry | \`data/cache/UserGraphCache.kt\` | — | the 3 cache tests pass |
| 2 | \`UserRepositoryTest.kt\` — read the cache before the network | \`data/repository/UserRepository.kt\` | — | the new test passes and the old ones stay green |
| 3 | [NO-TEST] wiring only | \`di/CacheModule.kt\` | — | the app starts and step 2 still passes |

### 9. Work sequencing
| Slice | Owns these files | Runs after | Deliverable |
|---|---|---|---|
| A: cache class | \`data/cache/UserGraphCache.kt\`, \`test/data/cache/UserGraphCacheTest.kt\` | — | the 3 cache tests pass |
| B: repository wiring | \`data/repository/UserRepository.kt\`, \`di/CacheModule.kt\` | A | the new repository test passes |

### 11. Validation plan
- **11a. Unit tests**: \`UserGraphCacheTest.kt\`, \`UserRepositoryTest.kt\`.
- **11b. Mocked integration tests**: SKIPPED — no external dependency changes.
- **11c. Visual verification**: SKIPPED — no UI change.
- **11d. Metrics and logs**: watch \`profile_load_p95\` after the change lands.
`;

test("a plan that follows the template produces no findings", () => {
  const findings = validatePlan(planFrom(GOOD));
  assert.deepEqual(findings, [], `unexpected findings: ${JSON.stringify(findings, null, 2)}`);
});

test("parseSections keys sections by number", () => {
  const sections = parseSections(GOOD);
  assert.ok(sections.get("1")?.includes("stops re-fetching"));
  assert.ok(sections.get("8")?.includes("UserGraphCacheTest.kt"));
  assert.equal(sections.get("3"), undefined);
});

test("planTodos reads one entry per cycle from section 8", () => {
  const todos = planTodos(planFrom(GOOD));
  assert.equal(todos.length, 3);
  assert.equal(todos[0]?.index, 1);
  assert.match(todos[0]!.red, /UserGraphCacheTest\.kt/);
  assert.equal(todos[2]!.red, "[NO-TEST] wiring only");
});

test("missing sections are errors", () => {
  const findings = validatePlan(planFrom("### 1. Goal\nSomething.\n"));
  const sections = findings.filter((f) => f.severity === "error").map((f) => f.section);
  assert.ok(sections.includes("§1a"));
  assert.ok(sections.includes("§6"));
  assert.ok(sections.includes("§7"));
  assert.ok(sections.includes("§8"));
  assert.ok(sections.includes("§11"));
});

test("vague success criteria are rejected", () => {
  const raw = GOOD.replace(
    "`Profile page p95 load time <= 300ms` · verified by the new `profile_load_p95` benchmark.",
    "The profile page should feel much faster and generally nicer.",
  );
  const findings = validatePlan(planFrom(raw));
  assert.ok(findings.some((f) => f.section === "§1a" && /No number/.test(f.message)));
  assert.ok(findings.some((f) => f.section === "§1a" && /No verification/.test(f.message)));
});

test("a file tree without tags is rejected", () => {
  const raw = GOOD.replace(/\[(NEW|EDIT|DELETE|MOVE)\]/g, "");
  const findings = validatePlan(planFrom(raw));
  assert.ok(findings.some((f) => f.section === "§6" && /tags/.test(f.message)));
});

test("prose instead of a diagram is rejected", () => {
  const raw = GOOD.replace(
    /\n### 7\. Flow diagram[\s\S]*?\n### 8\./,
    "\n### 7. Flow diagram\nThe screen asks the repository, which checks the cache and falls back to the network.\n\n### 8.",
  );
  const findings = validatePlan(planFrom(raw));
  assert.ok(findings.some((f) => f.section === "§7" && /No ASCII diagram/.test(f.message)));
});

test("a cycle with an empty Red column is an error", () => {
  const raw = GOOD.replace(
    "| 2 | `UserRepositoryTest.kt` — read the cache before the network |",
    "| 2 |  |",
  );
  const findings = validatePlan(planFrom(raw));
  assert.ok(findings.some((f) => f.section === "§8" && /Cycle 2: the Red column is empty/.test(f.message)));
});

test("two slices claiming the same file is an error", () => {
  const raw = GOOD.replace(
    "| B: repository wiring | `data/repository/UserRepository.kt`, `di/CacheModule.kt` | A |",
    "| B: repository wiring | `data/repository/UserRepository.kt`, `data/cache/UserGraphCache.kt` | A |",
  );
  const findings = validatePlan(planFrom(raw));
  assert.ok(findings.some((f) => f.section === "§9" && /One file, one owner/.test(f.message)));
});

test("an empty validation category is an error", () => {
  const raw = GOOD.replace(
    "- **11d. Metrics and logs**: watch `profile_load_p95` after the change lands.",
    "- **11d. Metrics and logs**:",
  );
  const findings = validatePlan(planFrom(raw));
  assert.ok(findings.some((f) => f.section === "§11" && /11d is empty/.test(f.message)));
});

test("SKIPPED satisfies a validation category", () => {
  const findings = validatePlan(planFrom(GOOD));
  assert.equal(findings.filter((f) => f.section === "§11").length, 0);
});
