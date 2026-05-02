import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  assertWorkflowFolderShape,
  checkArgs,
  FR_CANONICAL_ORDER,
  printUsage,
  validateAdrSet,
  validateAgentListContent,
  validateDocsTokenBudget,
  validateFrFields,
  validateHitlArtifactSource,
} from "./check.ts";

// --- printUsage ---

Deno.test("printUsage — contains Usage and deno task check", () => {
  const text = printUsage();
  assertEquals(text.includes("Usage:"), true);
  assertEquals(text.includes("deno task check"), true);
});

Deno.test("printUsage — mentions checks performed", () => {
  const text = printUsage();
  assertEquals(text.includes("Formatting check"), true);
  assertEquals(text.includes("Linting"), true);
  assertEquals(text.includes("Tests"), true);
  assertEquals(text.includes("Workflow integrity"), true);
  assertEquals(text.includes("AGENTS.md agent list accuracy"), true);
  assertEquals(text.includes("ADR set lint"), true);
  assertEquals(text.includes("Comment marker scan"), true);
});

// --- checkArgs ---

Deno.test("checkArgs — --help returns usage text with code 0", () => {
  const result = checkArgs(["--help"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task check"), true);
});

Deno.test("checkArgs — -h returns usage text with code 0", () => {
  const result = checkArgs(["-h"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task check"), true);
});

Deno.test("checkArgs — unknown arg returns error string with code 1", () => {
  const result = checkArgs(["--verbose"]);
  assertEquals(result?.code, 1);
  assertEquals(result?.text.includes("Unknown argument: --verbose"), true);
  assertEquals(result?.text.includes("--help"), true);
});

Deno.test("checkArgs — unknown positional arg returns error with code 1", () => {
  const result = checkArgs(["somefile"]);
  assertEquals(result?.code, 1);
  assertEquals(result?.text.includes("Unknown argument: somefile"), true);
});

Deno.test("checkArgs — empty args returns null (ok)", () => {
  const result = checkArgs([]);
  assertEquals(result, null);
});

// --- validateAgentListContent ---

Deno.test("validateAgentListContent — valid 6-agent content passes", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Tech Lead Review\n\n## Next Section\n";
  const errors = validateAgentListContent(content);
  assertEquals(errors, []);
});

Deno.test("validateAgentListContent — missing agent fails", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA\n\n## Next\n";
  const errors = validateAgentListContent(content);
  assertEquals(
    errors.some((e: string) => e.includes("Tech Lead Review")),
    true,
  );
});

Deno.test("validateAgentListContent — deprecated agent Presenter fails", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Tech Lead Review, Presenter\n\n## Next\n";
  const errors = validateAgentListContent(content);
  assertEquals(errors.some((e: string) => e.includes("Presenter")), true);
});

Deno.test("validateAgentListContent — deprecated agent Reviewer fails", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Tech Lead Review\n\nReviewer also exists\n## Next\n";
  const errors = validateAgentListContent(content);
  assertEquals(errors.some((e: string) => e.includes("Reviewer")), true);
});

Deno.test("validateAgentListContent — missing Project Vision section fails", () => {
  const content = "## Some Section\ncontent\n";
  const errors = validateAgentListContent(content);
  assertEquals(
    errors.some((e: string) => e.includes("Project Vision")),
    true,
  );
});

Deno.test("validateAgentListContent — real AGENTS.md passes", async () => {
  const content = await Deno.readTextFile("AGENTS.md");
  const errors = validateAgentListContent(content);
  assertEquals(errors, []);
});

// --- validateHitlArtifactSource ---

Deno.test("validateHitlArtifactSource — valid template path passes", () => {
  const errors = validateHitlArtifactSource(
    "{{input.specification}}/01-spec.md",
  );
  assertEquals(errors, []);
});

Deno.test("validateHitlArtifactSource — hardcoded path fails", () => {
  const errors = validateHitlArtifactSource("plan/specification/01-spec.md");
  assertEquals(errors.length > 0, true);
  assertEquals(errors.some((e: string) => e.includes("artifact_source")), true);
});

Deno.test("validateHitlArtifactSource — absent field skips (passes)", () => {
  const errors = validateHitlArtifactSource(undefined);
  assertEquals(errors, []);
});

Deno.test("validateHitlArtifactSource — empty string skips (passes)", () => {
  const errors = validateHitlArtifactSource("");
  assertEquals(errors, []);
});

// --- validateDocsTokenBudget ---

Deno.test("validateDocsTokenBudget — empty input returns no offenders", () => {
  assertEquals(validateDocsTokenBudget([], 30000), []);
});

Deno.test("validateDocsTokenBudget — file under budget passes", () => {
  const offenders = validateDocsTokenBudget(
    [{ path: "documents/small.md", size: 1234 }],
    30000,
  );
  assertEquals(offenders, []);
});

Deno.test("validateDocsTokenBudget — file exactly at budget passes (strict >)", () => {
  const offenders = validateDocsTokenBudget(
    [{ path: "documents/boundary.md", size: 30000 }],
    30000,
  );
  assertEquals(offenders, []);
});

Deno.test("validateDocsTokenBudget — file over budget reports one offender", () => {
  const offenders = validateDocsTokenBudget(
    [{ path: "documents/big.md", size: 40000 }],
    30000,
  );
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("documents/big.md"), true);
  assertEquals(offenders[0].includes("40000 bytes"), true);
  assertEquals(offenders[0].includes("30000 bytes budget"), true);
});

Deno.test("validateDocsTokenBudget — offender message includes estimated token count", () => {
  // 34000 bytes / 3.4 B/tok = 10000 tok
  const offenders = validateDocsTokenBudget(
    [{ path: "documents/a.md", size: 34000 }],
    30000,
  );
  assertEquals(offenders[0].includes("~10000 tok"), true);
});

Deno.test("validateDocsTokenBudget — mixed list returns only over-budget entries", () => {
  const offenders = validateDocsTokenBudget(
    [
      { path: "documents/a.md", size: 1000 },
      { path: "documents/b.md", size: 50000 },
      { path: "documents/c.md", size: 29999 },
      { path: "documents/d.md", size: 30001 },
    ],
    30000,
  );
  assertEquals(offenders.length, 2);
  assertEquals(offenders[0].includes("documents/b.md"), true);
  assertEquals(offenders[1].includes("documents/d.md"), true);
});

// --- FR-S47/DoD-1: workflow folder shape contract ----------------------

async function makeShapeFixture(
  root: string,
  name: string,
  opts: { agents?: string[]; yamlReferencesAgents?: boolean } = {},
): Promise<string> {
  const dir = join(root, name);
  await Deno.mkdir(dir, { recursive: true });
  const yamlBody = opts.yamlReferencesAgents
    ? `name: ${name}\nversion: "1"\nnodes:\n  pm:\n    type: agent\n    label: pm\n    system_prompt: "{{file(\\"${dir}/agents/agent-pm.md\\")}}"\n`
    : `name: ${name}\nversion: "1"\nnodes:\n  only:\n    type: agent\n    label: only\n    prompt: "hello"\n`;
  await Deno.writeTextFile(join(dir, "workflow.yaml"), yamlBody);
  if (opts.agents !== undefined) {
    await Deno.mkdir(join(dir, "agents"), { recursive: true });
    for (const agent of opts.agents) {
      await Deno.writeTextFile(
        join(dir, "agents", agent),
        `# ${agent} prompt\n`,
      );
    }
  }
  return dir;
}

Deno.test("assertWorkflowFolderShape — yaml + agents/agent-*.md is OK", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "shape-ok-" });
  try {
    const dir = await makeShapeFixture(tmp, "wf", {
      agents: ["agent-pm.md"],
      yamlReferencesAgents: true,
    });
    const errors = await assertWorkflowFolderShape(dir);
    assertEquals(errors, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("assertWorkflowFolderShape — missing agents/ when YAML references it fails", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "shape-noagents-" });
  try {
    const dir = await makeShapeFixture(tmp, "wf", {
      yamlReferencesAgents: true,
    });
    const errors = await assertWorkflowFolderShape(dir);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].includes("missing agents/"), true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("assertWorkflowFolderShape — no agents/ allowed when YAML doesn't reference it", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "shape-noref-" });
  try {
    const dir = await makeShapeFixture(tmp, "wf", {
      yamlReferencesAgents: false,
    });
    const errors = await assertWorkflowFolderShape(dir);
    assertEquals(errors, []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("assertWorkflowFolderShape — missing workflow.yaml fails", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "shape-noyaml-" });
  try {
    const dir = join(tmp, "wf");
    await Deno.mkdir(dir, { recursive: true });
    const errors = await assertWorkflowFolderShape(dir);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].includes("missing workflow.yaml"), true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("assertWorkflowFolderShape — empty agents/ dir fails when present", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "shape-emptyagents-" });
  try {
    const dir = await makeShapeFixture(tmp, "wf", {
      agents: [],
      yamlReferencesAgents: false,
    });
    const errors = await assertWorkflowFolderShape(dir);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].includes("contains no agent-*.md"), true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// --- FR-E63: validateAdrSet ---------------------------------------------

function makeAdr(
  number: string,
  title: string,
  status = "Accepted",
  bodyExtra = "",
): { name: string; content: string } {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-|-$/g,
    "",
  );
  return {
    name: `${number}-${slug}.md`,
    content: `# ADR-${number}: ${title}

## Status

${status}

## Context

ctx body

## Decision

decision body${bodyExtra}

## Consequences

consequences body

## Alternatives Considered

- alt
`,
  };
}

Deno.test("validateAdrSet — empty input returns no offenders", () => {
  assertEquals(validateAdrSet([]), []);
});

Deno.test("validateAdrSet — single well-formed ADR passes", () => {
  const offenders = validateAdrSet([makeAdr("0001", "first")]);
  assertEquals(offenders, []);
});

Deno.test("validateAdrSet — contiguous numbering 0001..0010 passes", () => {
  const files: Array<{ name: string; content: string }> = [];
  for (let i = 1; i <= 10; i++) {
    files.push(makeAdr(String(i).padStart(4, "0"), `record-${i}`));
  }
  assertEquals(validateAdrSet(files), []);
});

Deno.test("validateAdrSet — bad filename pattern flagged", () => {
  const bad = makeAdr("0001", "ok");
  bad.name = "not-an-adr.md";
  const offenders = validateAdrSet([bad]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("not-an-adr.md"), true);
  assertEquals(offenders[0].includes("filename does not match"), true);
});

Deno.test("validateAdrSet — numbering gap flagged", () => {
  const offenders = validateAdrSet([
    makeAdr("0001", "a"),
    makeAdr("0003", "c"), // gap: 0002 missing
  ]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("0003-c.md"), true);
  assertEquals(offenders[0].includes("expected 0002"), true);
});

Deno.test("validateAdrSet — duplicate numbers flagged", () => {
  const offenders = validateAdrSet([
    makeAdr("0001", "a"),
    makeAdr("0001", "a-dup"),
  ]);
  assertEquals(
    offenders.some((o) => o.includes("duplicate ADR number 1")),
    true,
  );
});

Deno.test("validateAdrSet — first ADR not 0001 flagged", () => {
  const offenders = validateAdrSet([makeAdr("0002", "a")]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("expected 0001"), true);
});

Deno.test("validateAdrSet — missing required section flagged", () => {
  const broken = makeAdr("0001", "a");
  broken.content = broken.content.replace(
    /## Alternatives Considered[\s\S]*$/,
    "",
  );
  const offenders = validateAdrSet([broken]);
  assertEquals(
    offenders.some((o) =>
      o.includes(
        "missing required section heading '## Alternatives Considered'",
      )
    ),
    true,
  );
});

Deno.test("validateAdrSet — sections out of order flagged", () => {
  const reordered = {
    name: "0001-r.md",
    content: `# ADR-0001: r

## Decision

x

## Status

Accepted

## Context

x

## Consequences

x

## Alternatives Considered

x
`,
  };
  const offenders = validateAdrSet([reordered]);
  // The walker finds Status/Context past Decision, then can't find a
  // Decision heading after that cursor — so it reports Decision.
  assertEquals(
    offenders.some((o) => o.includes("'## Decision'")),
    true,
  );
});

Deno.test("validateAdrSet — invalid Status value flagged", () => {
  const f = makeAdr("0001", "a", "Draft");
  const offenders = validateAdrSet([f]);
  assertEquals(
    offenders.some((o) => o.includes("Status value 'Draft'")),
    true,
  );
});

Deno.test("validateAdrSet — Proposed and Accepted both pass", () => {
  const offenders = validateAdrSet([
    makeAdr("0001", "a", "Proposed"),
    makeAdr("0002", "b", "Accepted"),
  ]);
  assertEquals(offenders, []);
});

Deno.test("validateAdrSet — Superseded references existing ADR passes", () => {
  const offenders = validateAdrSet([
    makeAdr("0001", "a", "Superseded by ADR-0002"),
    makeAdr("0002", "b", "Accepted"),
  ]);
  assertEquals(offenders, []);
});

Deno.test("validateAdrSet — Superseded references missing ADR flagged", () => {
  const offenders = validateAdrSet([
    makeAdr("0001", "a", "Superseded by ADR-0099"),
  ]);
  assertEquals(
    offenders.some((o) => o.includes("Status references ADR-0099")),
    true,
  );
});

Deno.test("validateAdrSet — body cross-reference to missing ADR flagged", () => {
  const f = makeAdr(
    "0001",
    "a",
    "Accepted",
    "\n\nSee ADR-0099 for follow-up.",
  );
  const offenders = validateAdrSet([f]);
  assertEquals(
    offenders.some((o) => o.includes("ADR-0099 does not resolve")),
    true,
  );
});

Deno.test("validateAdrSet — body cross-reference to present ADR passes", () => {
  const offenders = validateAdrSet([
    makeAdr("0001", "a", "Accepted", "\n\nSee ADR-0002."),
    makeAdr("0002", "b", "Accepted"),
  ]);
  assertEquals(offenders, []);
});

Deno.test("validateAdrSet — real shipped ADR set passes", async () => {
  const files: Array<{ name: string; content: string }> = [];
  try {
    for await (const entry of Deno.readDir("documents/adrs")) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      if (entry.name === "README.md" || entry.name === "_template.md") continue;
      const content = await Deno.readTextFile(`documents/adrs/${entry.name}`);
      files.push({ name: entry.name, content });
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      // No ADR directory in this checkout — skip.
      return;
    }
    throw err;
  }
  assertEquals(validateAdrSet(files), []);
});

// --- ADR-0012: FR canonical field set --------------------------------------

const FR_OK = `<!-- section -->

# SRS — Sample

### 3.1 FR-E1: Sample
- **Description:** Body.
- **Acceptance criteria:**
  - **Tests:** \`x_test.ts\` (FR-E1; regression-locked).
`;

Deno.test("validateFrFields — minimal mandatory pair passes", () => {
  assertEquals(validateFrFields([{ name: "fr.md", content: FR_OK }]), []);
});

Deno.test("validateFrFields — full canonical block passes", () => {
  const content = `### 3.1 FR-E1: Sample
- **Description:** d
- **Status:** Superseded by FR-E2
- **Motivation:** m
- **ADR:** ADR-0001
- **Dep:** FR-E0
- **Supersedes:** FR-E0
- **Input:** spec
- **Output:** plan
- **Acceptance criteria:**
  - x
`;
  assertEquals(validateFrFields([{ name: "fr.md", content }]), []);
});

Deno.test("validateFrFields — empty input returns no offenders", () => {
  assertEquals(validateFrFields([]), []);
});

Deno.test("validateFrFields — file with no FR sections returns no offenders", () => {
  assertEquals(
    validateFrFields([{ name: "f.md", content: "# Title\n\nNo FRs here.\n" }]),
    [],
  );
});

Deno.test("validateFrFields — unknown field flagged with allowlist hint", () => {
  const content = `### 3.1 FR-E1: T
- **Description:** d
- **Rationale:** r
- **Acceptance criteria:**
  - x
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("FR-E1"), true);
  assertEquals(offenders[0].includes("'Rationale'"), true);
  assertEquals(offenders[0].includes("allowed:"), true);
  assertEquals(offenders[0].includes("Description"), true);
});

Deno.test("validateFrFields — Acceptance (typo synonym) flagged", () => {
  const content = `### 3.1 FR-E1: T
- **Description:** d
- **Acceptance:** old-style
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.some((o) => o.includes("'Acceptance'")), true);
});

Deno.test("validateFrFields — Quality metrics flagged", () => {
  const content = `### 3.1 FR-S1: T
- **Description:** d
- **Acceptance criteria:**
  - x
- **Quality metrics:**
  - y
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.some((o) => o.includes("'Quality metrics'")), true);
});

Deno.test("validateFrFields — out-of-order field flagged", () => {
  const content = `### 3.1 FR-E1: T
- **Description:** d
- **Acceptance criteria:**
  - x
- **Motivation:** m
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("'Motivation'"), true);
  assertEquals(offenders[0].includes("'Acceptance criteria'"), true);
  assertEquals(offenders[0].includes("canonical order violated"), true);
});

Deno.test("validateFrFields — duplicate field flagged", () => {
  const content = `### 3.1 FR-E1: T
- **Description:** d1
- **Description:** d2
- **Acceptance criteria:**
  - x
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.some((o) => o.includes("duplicate field")), true);
});

Deno.test("validateFrFields — missing Description fails (mandatory)", () => {
  const content = `### 3.1 FR-E1: T
- **Acceptance criteria:**
  - x
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("missing mandatory"), true);
  assertEquals(offenders[0].includes("Description"), true);
});

Deno.test("validateFrFields — missing Acceptance criteria fails (no Status)", () => {
  const content = `### 3.1 FR-E1: T
- **Description:** d
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.length, 1);
  assertEquals(offenders[0].includes("missing 'Acceptance criteria'"), true);
});

Deno.test("validateFrFields — missing Acceptance OK when Status is present", () => {
  const content = `### 3.1 FR-S6: Absorbed
- **Description:** d
- **Status:** Superseded by FR-S15
`;
  assertEquals(validateFrFields([{ name: "f.md", content }]), []);
});

Deno.test("validateFrFields — nested **Tests:** is NOT a top-level field", () => {
  const content = `### 3.1 FR-E1: T
- **Description:** d
- **Acceptance criteria:**
  - **Tests:** \`a_test.ts\` (FR-E1; regression-locked).
  - [x] manual item.
`;
  // Nested two-space-indented fields must be ignored.
  assertEquals(validateFrFields([{ name: "f.md", content }]), []);
});

Deno.test("validateFrFields — multiple FRs in one file isolate field state", () => {
  const content = `### 3.1 FR-E1: A
- **Description:** d1
- **Acceptance criteria:**
  - x

### 3.2 FR-E2: B
- **Acceptance criteria:**
  - y
`;
  const offenders = validateFrFields([{ name: "f.md", content }]);
  assertEquals(offenders.length, 1);
  // FR-E2 missing Description, FR-E1 fine.
  assertEquals(offenders[0].includes("FR-E2"), true);
  assertEquals(offenders[0].includes("Description"), true);
});

Deno.test("validateFrFields — works on FR-S* ids too", () => {
  const content = `### 3.1 FR-S2: Stage
- **Description:** d
- **Input:** issue
- **Output:** spec.md
- **Acceptance criteria:**
  - x
`;
  assertEquals(validateFrFields([{ name: "f.md", content }]), []);
});

Deno.test("FR_CANONICAL_ORDER — canonical order constants are exported", () => {
  const order = FR_CANONICAL_ORDER as readonly string[];
  assertEquals(order[0], "Description");
  assertEquals(order[order.length - 1], "Acceptance criteria");
  assertEquals(order.includes("Status"), true);
  assertEquals(order.includes("Motivation"), true);
  assertEquals(order.includes("ADR"), true);
  assertEquals(order.includes("Dep"), true);
  assertEquals(order.includes("Supersedes"), true);
  assertEquals(order.includes("Input"), true);
  assertEquals(order.includes("Output"), true);
  // Removed fields MUST NOT appear:
  assertEquals(order.includes("Rationale"), false);
  assertEquals(order.includes("Quality metrics"), false);
  assertEquals(order.includes("Acceptance"), false);
});
