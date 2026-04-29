import { assertEquals } from "@std/assert";
import {
  adaptationPrompt,
  parseInitArgs,
  resolveWorkflowChoice,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// parseInitArgs
// ---------------------------------------------------------------------------

Deno.test("parseInitArgs — defaults to github-inbox workflow (not explicit)", () => {
  const parsed = parseInitArgs([]);
  assertEquals(parsed.kind, "run");
  if (parsed.kind !== "run") throw new Error("unreachable");
  assertEquals(parsed.workflow, "github-inbox");
  assertEquals(parsed.workflowExplicit, false);
  assertEquals(parsed.dryRun, false);
  assertEquals(parsed.allowDirty, false);
});

Deno.test("parseInitArgs — --workflow override marks explicit", () => {
  const parsed = parseInitArgs(["--workflow", "autonomous-sdlc"]);
  assertEquals(parsed.kind, "run");
  if (parsed.kind !== "run") throw new Error("unreachable");
  assertEquals(parsed.workflow, "autonomous-sdlc");
  assertEquals(parsed.workflowExplicit, true);
});

Deno.test("parseInitArgs — --workflow without value is an error", () => {
  const parsed = parseInitArgs(["--workflow"]);
  assertEquals(parsed.kind, "error");
});

Deno.test("parseInitArgs — --dry-run flag", () => {
  const parsed = parseInitArgs(["--dry-run"]);
  assertEquals(parsed.kind, "run");
  if (parsed.kind !== "run") throw new Error("unreachable");
  assertEquals(parsed.dryRun, true);
});

Deno.test("parseInitArgs — --allow-dirty flag", () => {
  const parsed = parseInitArgs(["--allow-dirty"]);
  assertEquals(parsed.kind, "run");
  if (parsed.kind !== "run") throw new Error("unreachable");
  assertEquals(parsed.allowDirty, true);
});

Deno.test("parseInitArgs — --help short-circuits", () => {
  assertEquals(parseInitArgs(["--help"]).kind, "help");
});

Deno.test("parseInitArgs — -h alias", () => {
  assertEquals(parseInitArgs(["-h"]).kind, "help");
});

Deno.test("parseInitArgs — --list flag", () => {
  assertEquals(parseInitArgs(["--list"]).kind, "list");
});

Deno.test("parseInitArgs — -l alias for --list", () => {
  assertEquals(parseInitArgs(["-l"]).kind, "list");
});

Deno.test("parseInitArgs — unknown flag produces error", () => {
  const parsed = parseInitArgs(["--nope"]);
  assertEquals(parsed.kind, "error");
  if (parsed.kind !== "error") throw new Error("unreachable");
  if (!parsed.message.includes("--nope")) {
    throw new Error(`expected '--nope' in error: ${parsed.message}`);
  }
});

Deno.test("parseInitArgs — combined flags", () => {
  const parsed = parseInitArgs([
    "--workflow",
    "github-inbox",
    "--allow-dirty",
    "--dry-run",
  ]);
  assertEquals(parsed.kind, "run");
  if (parsed.kind !== "run") throw new Error("unreachable");
  assertEquals(parsed.workflow, "github-inbox");
  assertEquals(parsed.workflowExplicit, true);
  assertEquals(parsed.allowDirty, true);
  assertEquals(parsed.dryRun, true);
});

// ---------------------------------------------------------------------------
// resolveWorkflowChoice — pure picker dispatch.
// ---------------------------------------------------------------------------

const SAMPLE = ["autonomous-sdlc", "github-inbox", "github-inbox-opencode"];

Deno.test("resolveWorkflowChoice — empty input picks the default", () => {
  const r = resolveWorkflowChoice("", SAMPLE, "github-inbox");
  assertEquals(r, { ok: true, workflow: "github-inbox" });
});

Deno.test("resolveWorkflowChoice — whitespace-only input picks the default", () => {
  const r = resolveWorkflowChoice("   \t  ", SAMPLE, "github-inbox");
  assertEquals(r, { ok: true, workflow: "github-inbox" });
});

Deno.test("resolveWorkflowChoice — empty input rejects when default not bundled", () => {
  const r = resolveWorkflowChoice("", SAMPLE, "missing-flow");
  assertEquals(r.ok, false);
});

Deno.test("resolveWorkflowChoice — 1-based numeric index resolves", () => {
  assertEquals(
    resolveWorkflowChoice("1", SAMPLE, "github-inbox"),
    { ok: true, workflow: "autonomous-sdlc" },
  );
  assertEquals(
    resolveWorkflowChoice("3", SAMPLE, "github-inbox"),
    { ok: true, workflow: "github-inbox-opencode" },
  );
});

Deno.test("resolveWorkflowChoice — out-of-range numeric input rejected", () => {
  const low = resolveWorkflowChoice("0", SAMPLE, "github-inbox");
  assertEquals(low.ok, false);
  const high = resolveWorkflowChoice("99", SAMPLE, "github-inbox");
  assertEquals(high.ok, false);
});

Deno.test("resolveWorkflowChoice — exact name match resolves", () => {
  const r = resolveWorkflowChoice("autonomous-sdlc", SAMPLE, "github-inbox");
  assertEquals(r, { ok: true, workflow: "autonomous-sdlc" });
});

Deno.test("resolveWorkflowChoice — typo rejected with descriptive message", () => {
  const r = resolveWorkflowChoice("github-inbx", SAMPLE, "github-inbox");
  assertEquals(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  if (!r.message.includes("github-inbx")) {
    throw new Error(`expected typo in message, got: ${r.message}`);
  }
});

Deno.test("resolveWorkflowChoice — name with surrounding whitespace is trimmed", () => {
  const r = resolveWorkflowChoice("  github-inbox  ", SAMPLE, "github-inbox");
  assertEquals(r, { ok: true, workflow: "github-inbox" });
});

// ---------------------------------------------------------------------------
// adaptationPrompt — printed at end of successful init.
// ---------------------------------------------------------------------------

Deno.test(
  "adaptationPrompt — embeds workflow dir and references key files to update",
  () => {
    const dir = ".flowai-workflow/github-inbox";
    const text = adaptationPrompt(dir);
    if (!text.includes(dir)) {
      throw new Error(
        `prompt must reference workflow dir ${dir}; got: ${text}`,
      );
    }
    if (!text.includes("workflow.yaml")) {
      throw new Error(`prompt must mention workflow.yaml`);
    }
    if (!text.includes("agents/agent-")) {
      throw new Error(`prompt must mention agents/agent-* files`);
    }
    if (!text.includes("Project Context")) {
      throw new Error(
        `prompt must mention the "Project Context" section agents add`,
      );
    }
  },
);

Deno.test(
  "adaptationPrompt — names the project parameters the user might fill in",
  () => {
    const text = adaptationPrompt(".flowai-workflow/x");
    for (
      const required of [
        "Default branch",
        "Test command",
        "Lint",
        "Project name",
      ]
    ) {
      if (!text.includes(required)) {
        throw new Error(
          `prompt must list "${required}" in the parameters block`,
        );
      }
    }
  },
);

Deno.test(
  "adaptationPrompt — explicitly forbids commit/push/PR side-effects",
  () => {
    const text = adaptationPrompt(".flowai-workflow/x");
    // Adapter agents must leave the diff for the user to review; don't
    // silently merge or push.
    if (
      !text.includes("Do NOT commit") || !text.includes("push") ||
      !text.includes("PR")
    ) {
      throw new Error(
        `prompt must explicitly forbid commit/push/PR side-effects`,
      );
    }
  },
);
