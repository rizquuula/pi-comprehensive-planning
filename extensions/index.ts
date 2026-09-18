/**
 * pi-comprehensive-planning — the extension half.
 *
 * The skills carry the judgement. This adds the three things prose cannot:
 * a deterministic trigger, a mechanical check on what got written, and a todo
 * list derived from the plan so the two cannot drift apart.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  PLAN_FILENAME,
  formatFindings,
  planTodos,
  readPlan,
  resolvePlanPath,
  validatePlan,
} from "./plan-file.ts";

const SKILL_PATH = fileURLToPath(new URL("../skills/comprehensive-planning/SKILL.md", import.meta.url));
const WIDGET_ID = "plan-todos";
/** The skill's own trigger: work spanning 3+ files deserves a plan. */
const NUDGE_AFTER_FILES = 3;

let touchedFiles = new Set<string>();
let nudged = false;

function readSkill(): string | null {
  try {
    return readFileSync(SKILL_PATH, "utf-8").replace(/^---[\s\S]*?\n---\n/, "").trim();
  } catch {
    return null;
  }
}

function refreshWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const plan = readPlan(resolvePlanPath(ctx.cwd));
  const todos = plan ? planTodos(plan) : [];

  if (todos.length === 0) {
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  const lines = [ctx.ui.theme.fg("accent", `${PLAN_FILENAME} · ${todos.length} cycles`)];
  for (const todo of todos) {
    const red = todo.red.length > 58 ? `${todo.red.slice(0, 57)}…` : todo.red;
    lines.push(`  ${ctx.ui.theme.fg("muted", `${todo.index}.`)} ${red}`);
  }
  ctx.ui.setWidget(WIDGET_ID, lines, { placement: "belowEditor" });
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    touchedFiles = new Set();
    nudged = false;
    refreshWidget(ctx);
  });

  // ---------------------------------------------------------------- /plan-comprehensively

  pi.registerCommand("plan-comprehensively", {
    description: "Produce a reviewable PLAN.md before touching code",
    handler: async (args, ctx) => {
      let task = (args ?? "").trim();
      if (!task) {
        if (!ctx.hasUI) {
          ctx.ui.notify("Usage: /plan-comprehensively <task>", "error");
          return;
        }
        task = (await ctx.ui.input("What should I plan?", ""))?.trim() ?? "";
      }
      if (!task) return;

      const skill = readSkill();
      const planPath = resolvePlanPath(ctx.cwd);
      const instruction = [
        "Write the plan to PLAN.md in the project root.",
        "Follow the template section by section, keeping the section headings exactly as written",
        "so the plan can be checked with plan_validate. Present it for review before writing any code.",
        "",
        `Task: ${task}`,
      ].join("\n");

      if (skill) {
        pi.sendUserMessage(`${skill}\n\n---\n\n${instruction}`);
      } else {
        // Skill file missing (filtered out or a broken install). Fall back to the skill command.
        pi.sendUserMessage(`/skill:comprehensive-planning ${task}\n\n${instruction}`, {
          expandPromptTemplates: true,
        });
      }

      pi.setSessionName(`Plan: ${task.slice(0, 48)}`);
      if (ctx.hasUI) {
        ctx.ui.setStatus(WIDGET_ID, ctx.ui.theme.fg("accent", `planning → ${PLAN_FILENAME}`));
        ctx.ui.notify(`Planning. The plan will be written to ${basename(planPath)}.`, "info");
      }
    },
  });

  // ---------------------------------------------------------------- plan_validate

  pi.registerTool({
    name: "plan_validate",
    label: "Validate Plan",
    description:
      "Check PLAN.md against the comprehensive-planning template: measurable success criteria, a tagged file tree, an ASCII flow diagram, test-first cycles, one owner per file, and a filled validation plan. Returns errors and warnings.",
    promptSnippet: "Check a written PLAN.md against the plan template",
    promptGuidelines: [
      "Use plan_validate after writing or editing PLAN.md, and fix every ERROR before starting implementation.",
      "Use plan_validate instead of reviewing PLAN.md by eye — it checks the mechanical rules.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: `Path to the plan file. Defaults to ${PLAN_FILENAME} in the working directory.` }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const path = resolvePlanPath(ctx.cwd, params.path);
      const plan = readPlan(path);

      if (!plan) {
        return {
          content: [
            {
              type: "text" as const,
              text: `${path} does not exist. Write the plan first — /plan-comprehensively starts one.`,
            },
          ],
          details: { found: false, errors: 1, warnings: 0 },
        };
      }

      const findings = validatePlan(plan);
      const errors = findings.filter((f) => f.severity === "error").length;
      const warnings = findings.length - errors;
      refreshWidget(ctx);

      return {
        content: [{ type: "text" as const, text: formatFindings(findings, path) }],
        details: { found: true, errors, warnings, findings },
      };
    },
  });

  // ---------------------------------------------------------------- the nudge

  pi.on("tool_call", async (event, ctx) => {
    const isEdit = isToolCallEventType("edit", event);
    const isWrite = isToolCallEventType("write", event);
    if (!isEdit && !isWrite) return;

    const path = (event.input as { path?: string }).path;
    if (!path || basename(path) === PLAN_FILENAME) return;

    touchedFiles.add(path);
    if (nudged || touchedFiles.size < NUDGE_AFTER_FILES) return;

    // Only speak up once, and only when a plan would plausibly have been worth it.
    if (readPlan(resolvePlanPath(ctx.cwd))) return;
    nudged = true;

    if (ctx.hasUI) {
      ctx.ui.notify(
        `${touchedFiles.size} files touched with no ${PLAN_FILENAME}. Run /plan-comprehensively if this is bigger than it looked.`,
        "warning",
      );
    }
  });

  // Keep the todo list in step with the plan file.
  pi.on("tool_result", async (event, ctx) => {
    const path = (event.input as { path?: string }).path;
    if (path && basename(path) === PLAN_FILENAME) refreshWidget(ctx);
  });
}
