/**
 * Reading and validating PLAN.md.
 *
 * The plan template lives in the `comprehensive-planning` skill. This module knows the
 * mechanical rules of that template: which sections must exist, which ones must carry
 * something checkable, and which ones only earn a warning when they are thin.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const PLAN_FILENAME = "PLAN.md";

export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  section: string;
  message: string;
}

export interface PlanFile {
  path: string;
  raw: string;
  /** Top-level sections, keyed by number as a string: "1", "6", "11". */
  sections: Map<string, string>;
}

export function resolvePlanPath(cwd: string, requested?: string): string {
  if (!requested) return join(cwd, PLAN_FILENAME);
  return isAbsolute(requested) ? requested : join(cwd, requested);
}

export function readPlan(path: string): PlanFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  return { path, raw, sections: parseSections(raw) };
}

/** Split on `## N. Title` / `### N. Title` headings, keyed by the number. */
export function parseSections(raw: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = raw.split(/\r?\n/);
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current !== null) sections.set(current, buffer.join("\n").trim());
  };

  for (const line of lines) {
    const heading = /^#{2,4}\s+(\d+)[.)]\s+/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!;
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return sections;
}

/** Markdown table rows as cell arrays, header and separator rows dropped. */
function tableRows(body: string): string[][] {
  const rows: string[][] = [];
  let seenHeader = false;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      // A blank line ends a table only after we have seen one.
      if (seenHeader && rows.length > 0 && trimmed === "") seenHeader = false;
      continue;
    }
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator
    if (!seenHeader) {
      seenHeader = true;
      continue; // header
    }
    rows.push(cells);
  }
  return rows;
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

const FILE_LIKE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|cpp|cc|cxx|h|hpp|kt|kts|dart|java|rb|php|cs|swift|sql|json|ya?ml|toml|md|proto|sh|tf)$/i;

export function validatePlan(plan: PlanFile): Finding[] {
  const findings: Finding[] = [];
  const { sections } = plan;

  const add = (severity: Severity, section: string, message: string) =>
    findings.push({ severity, section, message });

  const require = (n: string, label: string): string | null => {
    const body = sections.get(n);
    if (body === undefined) {
      add("error", `§${n}`, `Missing section ${label}.`);
      return null;
    }
    if (body.trim() === "") {
      add("error", `§${n}`, `${label} is present but empty.`);
      return null;
    }
    return body;
  };

  // §1 Goal — one sentence.
  const goal = require("1", "Goal");
  if (goal && goal.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("**")).length > 3) {
    add("warning", "§1", "Goal runs long. It should be one sentence.");
  }

  // §1a Success criteria — must be measurable and verifiable.
  const goalBody = goal ?? "";
  const criteria = /\*\*\s*1a\.[^*]*\*\*([\s\S]*?)(?=\n\s*\*\*\s*\d+[a-z]\.|$)/.exec(goalBody);
  if (!criteria) {
    add("error", "§1a", "Missing success criteria. Without them the goal is too vague.");
  } else {
    const text = criteria[1]!;
    const measurable = /\d/.test(text) || /≤|≥|<=|>=|<|>/.test(text);
    const verified = /verified by|test|metric|benchmark|manual check|measure/i.test(text);
    if (!measurable) {
      add("error", "§1a", "No number in the criteria. Use a measurable outcome, not an adjective.");
    }
    if (!verified) {
      add("error", "§1a", "No verification named. Say what proves the criterion (test, metric, manual check).");
    }
  }

  // §6 Files to change — needs tags.
  const files = require("6", "Files to change");
  if (files) {
    const tags = files.match(/\[(NEW|EDIT|DELETE|MOVE)\]/g) ?? [];
    if (tags.length === 0) {
      add("error", "§6", "No [NEW]/[EDIT]/[DELETE]/[MOVE] tags. Every listed file needs one.");
    }
    const treeLines = files.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (treeLines.length > 25) {
      add("warning", "§6", `File tree is ${treeLines.length} lines. The skill asks for under 25 — group the repeats.`);
    }
  }

  // §7 Flow diagram — must be an ASCII diagram, not prose.
  const flow = require("7", "Flow diagram");
  if (flow) {
    const hasArrow = /-->|->|←|→|\bv\b|\^/.test(flow);
    const hasBox = /\+[-=]{2,}/.test(flow) || /\|.*\|/.test(flow);
    if (!hasArrow || !hasBox) {
      add("error", "§7", "No ASCII diagram found. Draw boxes and arrows, not a paragraph.");
    }
  }

  // §8 Step-by-step breakdown — test-first cycles.
  const steps = require("8", "Step-by-step breakdown");
  const cycles = steps ? tableRows(steps) : [];
  if (steps && cycles.length === 0) {
    add("error", "§8", "No cycles found. The template expects an ordered table of test-first cycles.");
  }
  if (steps && cycles.length > 0 && cycles.length < 3) {
    add("warning", "§8", `Only ${cycles.length} cycle(s). Anything non-trivial usually needs 3–10.`);
  }
  cycles.forEach((cells, i) => {
    const n = i + 1;
    const red = cells[1] ?? "";
    const done = cells[cells.length - 1] ?? "";
    if (red.trim() === "") {
      add("error", "§8", `Cycle ${n}: the Red column is empty. Name the failing test first.`);
    } else if (!/\[NO-TEST\]/.test(red) && backticked(red).length === 0 && !FILE_LIKE.test(red)) {
      add("warning", "§8", `Cycle ${n}: Red names no test file. Use a path, or mark the cycle [NO-TEST] with a reason.`);
    }
    if (done.trim() === "" || done === "—") {
      add("error", "§8", `Cycle ${n}: no done-criterion. Every cycle ends green.`);
    }
  });

  // §9 Work sequencing — one owner per file.
  const slices = require("9", "Work sequencing");
  const sliceRows = slices ? tableRows(slices) : [];
  if (slices && sliceRows.length === 0) {
    add("warning", "§9", "No slices listed. Say what each slice owns and what runs after what.");
  }
  const owners = new Map<string, string[]>();
  sliceRows.forEach((cells, i) => {
    const slice = cells[0] ?? `slice ${i + 1}`;
    const owned = cells[1] ?? "";
    for (const path of backticked(owned)) {
      if (!FILE_LIKE.test(path)) continue;
      const key = path.replace(/^\.\//, "");
      owners.set(key, [...(owners.get(key) ?? []), slice]);
    }
  });
  for (const [path, claimers] of owners) {
    if (claimers.length > 1) {
      add("error", "§9", `${path} is claimed by ${claimers.length} slices (${claimers.join(", ")}). One file, one owner.`);
    }
  }

  // §11 Validation plan — every category filled or explicitly skipped.
  const validation = require("11", "Validation plan");
  if (validation) {
    for (const label of ["11a", "11b", "11c", "11d"]) {
      const re = new RegExp(`\\*\\*\\s*${label}\\.[^*]*\\*\\*([\\s\\S]*?)(?=\\n\\s*[-*]?\\s*\\*\\*\\s*11[a-z]\\.|$)`);
      const m = re.exec(validation);
      if (!m) {
        add("warning", "§11", `${label} is not marked. Keep the template's labels.`);
        continue;
      }
      const body = m[1]!.trim();
      if (body === "" || /^[:：]$/.test(body)) {
        add("error", "§11", `${label} is empty. Fill it, or write SKIPPED with a reason.`);
      } else if (!/SKIPPED/i.test(body) && body.replace(/^[:：]/, "").trim() === "") {
        add("error", "§11", `${label} is empty. Fill it, or write SKIPPED with a reason.`);
      }
    }
  }

  return findings;
}

/** The ordered todo list a plan implies: one entry per §8 cycle. */
export interface TodoItem {
  index: number;
  red: string;
  done: string;
}

export function planTodos(plan: PlanFile): TodoItem[] {
  const steps = plan.sections.get("8");
  if (!steps) return [];
  return tableRows(steps).map((cells, i) => ({
    index: i + 1,
    red: (cells[1] ?? "").replace(/\s+/g, " ").trim(),
    done: (cells[cells.length - 1] ?? "").replace(/\s+/g, " ").trim(),
  }));
}

export function formatFindings(findings: Finding[], planPath: string): string {
  if (findings.length === 0) {
    return `${planPath}: no problems found. The plan satisfies the template's mechanical rules.`;
  }
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const lines: string[] = [
    `${planPath}: ${errors.length} error(s), ${warnings.length} warning(s).`,
    "",
  ];
  for (const f of [...errors, ...warnings]) {
    lines.push(`${f.severity === "error" ? "ERROR" : "warn "} ${f.section.padEnd(5)} ${f.message}`);
  }
  lines.push("");
  lines.push("Fix the errors and re-run plan_validate. Warnings are judgement calls — read them and decide.");
  return lines.join("\n");
}
