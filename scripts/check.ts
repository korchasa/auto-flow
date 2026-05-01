/**
 * @module
 * Full project verification: fmt --check, lint, type-check, CLI smoke test,
 * secret scan, tests, doc lint, workflow integrity, AGENTS.md accuracy, and
 * comment-marker scan (TODO/FIXME/HACK/XXX).
 * Run via: deno task check
 */

async function run(
  cmd: string,
  args: string[],
  label: string,
  allowFailure = false,
): Promise<boolean> {
  console.log(`\n--- ${label} ---`);
  console.log(`> ${cmd} ${args.join(" ")}`);
  let success: boolean;
  try {
    const process = new Deno.Command(cmd, {
      args,
      stdout: "inherit",
      stderr: "inherit",
    });
    ({ success } = await process.output());
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      if (allowFailure) {
        console.warn(`SKIPPED (${cmd} not found): ${label}`);
        return false;
      }
      console.error(`FAILED: ${label} — '${cmd}' not found`);
      Deno.exit(1);
    }
    throw e;
  }
  if (!success) {
    if (allowFailure) {
      console.warn(`SKIPPED (no modules): ${label}`);
      return false;
    }
    console.error(`FAILED: ${label}`);
    Deno.exit(1);
  }
  return true;
}

async function commentScan(): Promise<void> {
  console.log("\n--- Comment Scan ---");
  const patterns = ["TODO", "FIXME", "HACK", "XXX"];
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".sh"];
  let found = false;

  for await (const entry of walkDir(".")) {
    if (!extensions.some((ext) => entry.endsWith(ext))) continue;
    if (
      entry.includes("node_modules") ||
      entry.includes(".flowai-workflow/workflow") ||
      entry.endsWith("scripts/check.ts")
    ) {
      continue;
    }

    const content = await Deno.readTextFile(entry);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        if (lines[i].includes(pattern)) {
          console.warn(`  ${pattern} found: ${entry}:${i + 1}`);
          found = true;
        }
      }
    }
  }

  if (found) {
    console.error("FAILED: Comment markers found (TODO/FIXME/HACK/XXX)");
    Deno.exit(1);
  } else {
    console.log("  No comment markers found.");
  }
}

async function hasTestFiles(dir: string): Promise<boolean> {
  for await (const entry of walkDir(dir)) {
    if (entry.match(/[._]test\.ts$/) || entry.match(/test[._].*\.ts$/)) {
      return true;
    }
  }
  return false;
}

async function* walkDir(
  dir: string,
  skipDirs?: Set<string>,
): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory && !entry.name.startsWith(".")) {
      if (skipDirs?.has(entry.name)) continue;
      yield* walkDir(path, skipDirs);
    } else if (entry.isFile) {
      yield path;
    }
  }
}

/** FR-S47/FR-E53: list workflow folders directly under `root` that contain
 * `workflow.yaml`. Used by the workflow-integrity check; intentionally
 * decoupled from the CLI parser. */
async function listWorkflowFolders(root: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (!entry.isDirectory) continue;
      const dir = `${root}/${entry.name}`;
      try {
        const stat = await Deno.stat(`${dir}/workflow.yaml`);
        if (stat.isFile) out.push(dir);
      } catch {
        // No workflow.yaml — skip
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return out.sort();
}

/** FR-S47/DoD-1: enforce that a workflow folder has the required shape.
 * `workflow.yaml` is required. `agents/` is required IFF the workflow uses
 * agent prompt files (i.e. `workflow.yaml` references `agents/agent-*.md`).
 * `memory/`, `scripts/`, `runs/` are always optional. (FR-E57: per-run git
 * worktrees live under `runs/<run-id>/worktree/`.)
 * Returns offender messages; empty = OK. */
export async function assertWorkflowFolderShape(
  dir: string,
): Promise<string[]> {
  const errors: string[] = [];
  let yamlText = "";
  try {
    yamlText = await Deno.readTextFile(`${dir}/workflow.yaml`);
  } catch {
    errors.push(`${dir}: missing workflow.yaml`);
    return errors;
  }
  // Heuristic: any reference to `agents/agent-` (e.g. via {{file(...)}})
  // implies the workflow expects an agents/ folder.
  const referencesAgents = /agents\/agent-[\w-]+\.md/.test(yamlText);
  let agentsDirExists = false;
  try {
    const stat = await Deno.stat(`${dir}/agents`);
    agentsDirExists = stat.isDirectory;
  } catch {
    // agents/ absent
  }
  let hasAgent = false;
  if (agentsDirExists) {
    for await (const entry of Deno.readDir(`${dir}/agents`)) {
      if (
        entry.isFile && entry.name.startsWith("agent-") &&
        entry.name.endsWith(".md")
      ) {
        hasAgent = true;
        break;
      }
    }
  }
  if (referencesAgents && !agentsDirExists) {
    errors.push(
      `${dir}: missing agents/ directory (referenced from workflow.yaml)`,
    );
  } else if (agentsDirExists && !hasAgent) {
    errors.push(`${dir}: agents/ contains no agent-*.md file`);
  }
  return errors;
}

async function workflowIntegrity(): Promise<void> {
  console.log("\n--- Workflow Integrity ---");
  const root = ".flowai-workflow";
  const folders = await listWorkflowFolders(root);
  if (folders.length === 0) {
    // Fresh end-user project: no workflow yet — non-blocking.
    console.log(
      `  No workflow folders found under ${root}/ (fresh project).`,
    );
    return;
  }

  const { loadConfig } = await import("../config.ts");
  for (const dir of folders) {
    const shapeErrors = await assertWorkflowFolderShape(dir);
    if (shapeErrors.length > 0) {
      for (const e of shapeErrors) console.error(`  ${e}`);
      console.error(`FAILED: Workflow folder shape: ${dir}`);
      Deno.exit(1);
    }
    const workflowPath = `${dir}/workflow.yaml`;
    try {
      await loadConfig(workflowPath);
      console.log(`  Workflow config valid: ${workflowPath}`);
    } catch (err) {
      console.error(`FAILED: Workflow validation: ${(err as Error).message}`);
      Deno.exit(1);
    }
  }
}

/** FR-S47/DoD-3: scan active configs/code for residual `.claude/agents/`
 * references (post-migration `.claude/agents/` is removed; agents live under
 * `.flowai-workflow/<name>/agents/`).
 * Scans `*.yaml`, `*.yml`, `*.json`, `*.ts` only — `.md` and `.sh` are
 * excluded because docs/scripts may legitimately mention the path as a
 * Claude Code IDE feature distinct from flowai-workflow agent layout.
 * Skips runtime data dirs and the `documents/` tree (R&D references). */
export async function noClaudeAgentsRefs(): Promise<string[]> {
  const offenders: string[] = [];
  const skipPathFragments = [
    "/runs/",
    "/.claude/worktrees/",
    "node_modules/",
    "/documents/",
  ];
  const skipExactRel = new Set([
    "scripts/check.ts",
    "scripts/check_test.ts",
  ]);
  const exts = [".ts", ".yaml", ".yml", ".json"];

  const stack: string[] = ["."];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: AsyncIterable<Deno.DirEntry>;
    try {
      entries = Deno.readDir(dir);
    } catch {
      continue;
    }
    for await (const entry of entries) {
      const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name.startsWith(".") && entry.name !== ".flowai-workflow") {
          continue;
        }
        if (skipPathFragments.some((frag) => `/${path}/`.includes(frag))) {
          continue;
        }
        stack.push(path);
        continue;
      }
      if (!exts.some((e) => path.endsWith(e))) continue;
      if (skipPathFragments.some((frag) => `/${path}`.includes(frag))) continue;
      if (skipExactRel.has(path)) continue;
      const text = await Deno.readTextFile(path);
      if (text.includes(".claude/agents/")) offenders.push(path);
    }
  }
  return offenders;
}

async function noClaudeAgentsCheck(): Promise<void> {
  console.log("\n--- No .claude/agents/ Refs ---");
  const offenders = await noClaudeAgentsRefs();
  if (offenders.length > 0) {
    for (const f of offenders) console.error(`  ${f}`);
    console.error(
      "FAILED: stale `.claude/agents/` references found (FR-S47/DoD-3).",
    );
    Deno.exit(1);
  }
  console.log("  No `.claude/agents/` references in tracked sources.");
}

/**
 * Validates that defaults.hitl.artifact_source uses template syntax.
 *
 * Returns error messages if a hardcoded path is detected (no `{{` present).
 * Returns empty array when the field is absent, empty, or contains a template.
 */
export function validateHitlArtifactSource(
  artifactSource: string | undefined,
): string[] {
  if (!artifactSource) return [];
  if (artifactSource.includes("{{")) return [];
  return [
    `workflow.yaml: defaults.hitl.artifact_source "${artifactSource}" is a hardcoded path; use template syntax (e.g. {{input.<node>}}/...)`,
  ];
}

async function hitlArtifactSource(): Promise<void> {
  console.log("\n--- HITL Artifact Source Validation ---");
  const folders = await listWorkflowFolders(".flowai-workflow");
  if (folders.length === 0) {
    console.log("  No workflow folders — skipped.");
    return;
  }
  const { loadConfig } = await import("../config.ts");
  for (const dir of folders) {
    const workflowPath = `${dir}/workflow.yaml`;
    let config;
    try {
      config = await loadConfig(workflowPath);
    } catch (err) {
      // Already reported by workflowIntegrity(); skip here.
      console.log(
        `  Skipped ${workflowPath} (config invalid): ${(err as Error).message}`,
      );
      continue;
    }
    const artifactSource = config.defaults?.hitl?.artifact_source;
    const errors = validateHitlArtifactSource(artifactSource);
    if (errors.length > 0) {
      for (const err of errors) console.error(`  ${err}`);
      console.error(
        "FAILED: HITL artifact_source must use template syntax ({{input.<node>}})",
      );
      Deno.exit(1);
    }
  }
  console.log("  HITL artifact_source uses template syntax (all workflows).");
}

/**
 * Validates AGENTS.md content for agent list accuracy.
 *
 * Checks that the Project Vision section lists all 6 active workflow agents
 * and that no deprecated agent names appear anywhere in the document.
 * Returns an array of error messages; empty array means validation passed.
 */
export function validateAgentListContent(content: string): string[] {
  const expectedAgents = [
    "PM",
    "Architect",
    "Tech Lead",
    "Developer",
    "QA",
    "Tech Lead Review",
  ];
  const deprecatedAgents = [
    "Presenter",
    "Reviewer",
    "SDS Update",
    "Meta-Agent",
  ];
  const errors: string[] = [];

  const visionMatch = content.match(
    /## Project Vision\n([\s\S]*?)(?=\n## |\n# |$)/,
  );
  if (!visionMatch) {
    return ["AGENTS.md: ## Project Vision section not found"];
  }
  // Normalize line breaks to spaces so word-wrapped agent names match correctly
  const visionSection = visionMatch[1].replace(/\n/g, " ");

  for (const agent of expectedAgents) {
    if (!visionSection.includes(agent)) {
      errors.push(
        `AGENTS.md: Expected agent "${agent}" not found in Project Vision`,
      );
    }
  }

  for (const agent of deprecatedAgents) {
    if (content.includes(agent)) {
      errors.push(`AGENTS.md: Deprecated agent "${agent}" found in AGENTS.md`);
    }
  }

  return errors;
}

async function agentListAccuracy(): Promise<void> {
  console.log("\n--- AGENTS.md Agent List Accuracy ---");
  const content = await Deno.readTextFile("AGENTS.md");
  const errors = validateAgentListContent(content);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`  ${err}`);
    }
    console.error("FAILED: AGENTS.md agent list is inaccurate");
    Deno.exit(1);
  }
  console.log("  AGENTS.md agent list valid (6 active agents, no deprecated).");
}

// Empirical byte-to-token ratio measured on SRS/SDS markdown. Used both
// for the docs size budget and for the offender's estimated-token count
// so both numbers move together if the ratio is ever retuned.
const BYTES_PER_TOKEN = 3.4;
// Working budget leaves ~1200-token headroom under Read's 10k-token hard
// limit so files can grow before CI starts failing.
const DOCS_MAX_TOKENS = 8800;
const DOCS_MAX_BYTES = Math.round(DOCS_MAX_TOKENS * BYTES_PER_TOKEN);

/**
 * Pure core for `docsTokenBudget`: returns offender message lines for every
 * file whose size exceeds `maxBytes`. Extracted so the selection rule and
 * message format are unit-testable without file I/O. Mirrors the
 * `validateHitlArtifactSource` / `hitlArtifactSource` pattern used elsewhere
 * in this file.
 */
export function validateDocsTokenBudget(
  files: Array<{ path: string; size: number }>,
  maxBytes: number,
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (file.size > maxBytes) {
      const estTokens = Math.round(file.size / BYTES_PER_TOKEN);
      offenders.push(
        `${file.path}: ${file.size} bytes (~${estTokens} tok) > ${maxBytes} bytes budget`,
      );
    }
  }
  return offenders;
}

/**
 * Enforces per-file size budget on `documents/` so every doc fits in the
 * `Read` tool's 10k-token limit in one call. Tasks and rnd/ are
 * excluded at walk level — temp/reference, not subject to the budget.
 * Size comparison and message formatting live in `validateDocsTokenBudget`.
 */
async function docsTokenBudget(): Promise<void> {
  console.log("\n--- Docs Token Budget ---");
  const skipDirs = new Set(["tasks", "rnd"]);
  const files: Array<{ path: string; size: number }> = [];
  for await (const entry of walkDir("documents", skipDirs)) {
    if (!entry.endsWith(".md")) continue;
    const info = await Deno.stat(entry);
    files.push({ path: entry, size: info.size });
  }
  const offenders = validateDocsTokenBudget(files, DOCS_MAX_BYTES);
  if (offenders.length > 0) {
    for (const line of offenders) console.error(`  ${line}`);
    console.error(
      "FAILED: Docs token budget — split overlarge files by functional area (see AGENTS.md Read Efficiency).",
    );
    Deno.exit(1);
  }
  console.log("  All documents/ files fit within Read-tool token budget.");
}

/**
 * FR-E63: Pure validator for the ADR set under `documents/adrs/`.
 *
 * Input: an array of `{ name, content }` for every `.md` file under the
 * directory EXCEPT `README.md` and `_template.md` (the caller filters
 * those out). Output: offender messages; empty array means the set is
 * compliant. Pure — no FS I/O — so the caller's `adrSet()` wrapper can
 * supply fixtures from memory in tests.
 *
 * Enforced rules:
 *  - Filename matches `^\d{4}-[a-z0-9-]+\.md$`.
 *  - Numbering is contiguous from `0001`, no gaps, no duplicates.
 *  - Required level-2 sections present in this exact order:
 *    Status, Context, Decision, Consequences, Alternatives Considered.
 *  - Status value is `Proposed`, `Accepted`, or `Superseded by ADR-NNNN`.
 *  - `Superseded by ADR-NNNN` references an ADR present in the set.
 *  - Every `ADR-NNNN` cross-reference in any ADR body resolves to an
 *    ADR present in the set.
 */
export function validateAdrSet(
  files: Array<{ name: string; content: string }>,
): string[] {
  const offenders: string[] = [];
  const filenameRe = /^(\d{4})-[a-z0-9-]+\.md$/;
  const requiredSections = [
    "## Status",
    "## Context",
    "## Decision",
    "## Consequences",
    "## Alternatives Considered",
  ];

  // Step 1 — filename pattern + collect numbers.
  const numbers: Array<{ n: number; name: string }> = [];
  for (const f of files) {
    const m = f.name.match(filenameRe);
    if (!m) {
      offenders.push(
        `${f.name}: filename does not match ^\\d{4}-[a-z0-9-]+\\.md$`,
      );
      continue;
    }
    numbers.push({ n: Number(m[1]), name: f.name });
  }

  // Step 2 — monotonic numbering: contiguous from 0001, no gaps, no dups.
  if (numbers.length > 0) {
    const sorted = [...numbers].sort((a, b) => a.n - b.n);
    const seen = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      const expected = i + 1;
      const got = sorted[i].n;
      if (seen.has(got)) {
        offenders.push(`${sorted[i].name}: duplicate ADR number ${got}`);
        continue;
      }
      seen.add(got);
      if (got !== expected) {
        offenders.push(
          `${sorted[i].name}: numbering gap — expected ${
            String(expected).padStart(4, "0")
          }, got ${String(got).padStart(4, "0")}`,
        );
      }
    }
  }

  // Step 3 — required sections present and in the right order.
  for (const f of files) {
    if (!filenameRe.test(f.name)) continue; // already reported
    let cursor = 0;
    for (const heading of requiredSections) {
      const idx = f.content.indexOf(`\n${heading}\n`, cursor);
      if (idx === -1) {
        // Allow heading at the very top (no leading \n) — happens after
        // the H1 title, which is followed by a blank line + `## Status`.
        const head = f.content.startsWith(`${heading}\n`) ? 0 : -1;
        if (head === -1) {
          offenders.push(
            `${f.name}: missing required section heading '${heading}' (or out of order)`,
          );
          break;
        }
        cursor = head + heading.length;
      } else {
        cursor = idx + heading.length + 2;
      }
    }
  }

  // Step 4 — Status value.
  const adrNumberSet = new Set<number>(numbers.map((x) => x.n));
  for (const f of files) {
    if (!filenameRe.test(f.name)) continue;
    const statusBlock = f.content.match(/\n## Status\n([\s\S]*?)\n## /);
    if (!statusBlock) continue; // missing-section already reported
    const value = statusBlock[1].trim();
    const valueRe = /^(Proposed|Accepted|Superseded by ADR-(\d{4}))$/;
    const m = value.match(valueRe);
    if (!m) {
      offenders.push(
        `${f.name}: Status value '${value}' is not one of {Proposed, Accepted, Superseded by ADR-NNNN}`,
      );
      continue;
    }
    if (m[2] !== undefined) {
      const target = Number(m[2]);
      if (!adrNumberSet.has(target)) {
        offenders.push(
          `${f.name}: Status references ADR-${m[2]} which is not in the set`,
        );
      }
    }
  }

  // Step 5 — every ADR-NNNN cross-reference in body resolves.
  const xrefRe = /\bADR-(\d{4})\b/g;
  for (const f of files) {
    if (!filenameRe.test(f.name)) continue;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    xrefRe.lastIndex = 0;
    while ((match = xrefRe.exec(f.content)) !== null) {
      const ref = match[1];
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (!adrNumberSet.has(Number(ref))) {
        offenders.push(
          `${f.name}: cross-reference ADR-${ref} does not resolve to any ADR in the set`,
        );
      }
    }
  }

  return offenders;
}

/**
 * Canonical FR field set per ADR-0012.
 *
 * Mandatory: `Description`, `Acceptance criteria` (unless `Status`
 * is set, which marks the FR superseded/deprecated and lifts the
 * Acceptance requirement).
 *
 * Optional, in this exact order:
 * `Status` → `Motivation` → `ADR` → `Dep` → `Supersedes` →
 * `Input` / `Output` (workflow-stage FRs only).
 *
 * Only top-level `- **Field:**` bullets count — nested fields like
 * `**Tests:**` inside `Acceptance criteria` are skipped because
 * they sit at indent ≥ 2.
 *
 * Pure — no FS I/O — so the caller's `frFieldSet()` wrapper can
 * load files separately and tests can pass synthetic fixtures.
 *
 * Returns an empty array when every FR conforms; otherwise one
 * line per violation (`<file>:<line> FR-X<N>: <reason>`).
 */
export const FR_CANONICAL_ORDER = [
  "Description",
  "Status",
  "Motivation",
  "ADR",
  "Dep",
  "Supersedes",
  "Input",
  "Output",
  "Acceptance criteria",
] as const;

export function validateFrFields(
  files: Array<{ name: string; content: string }>,
): string[] {
  const offenders: string[] = [];
  const frHeaderRe = /^### \d+(?:\.\d+)?\s+(FR-[ES]\d+):/;
  // Field syntax: `- **Name:**` — colon sits inside the bold span,
  // before the closing `**`. The captured group is the bare name.
  const fieldRe = /^- \*\*([^*]+):\*\*/;
  const orderIndex = new Map<string, number>(
    FR_CANONICAL_ORDER.map((f, i) => [f, i]),
  );

  for (const { name, content } of files) {
    const lines = content.split("\n");
    let currentFr: string | null = null;
    let currentFrLine = 0;
    let frFields: Array<{ field: string; line: number }> = [];

    const flush = () => {
      if (!currentFr) return;
      const seen = new Set<string>();
      let lastIdx = -1;
      let lastField = "";
      for (const { field, line } of frFields) {
        if (!orderIndex.has(field)) {
          offenders.push(
            `${name}:${line + 1} ${currentFr}: unknown field '${field}' ` +
              `(allowed: ${FR_CANONICAL_ORDER.join(", ")})`,
          );
          continue;
        }
        if (seen.has(field)) {
          offenders.push(
            `${name}:${line + 1} ${currentFr}: duplicate field '${field}'`,
          );
          continue;
        }
        seen.add(field);
        const idx = orderIndex.get(field)!;
        if (idx < lastIdx) {
          offenders.push(
            `${name}:${line + 1} ${currentFr}: field '${field}' appears ` +
              `after '${lastField}' (canonical order violated)`,
          );
        }
        lastIdx = idx;
        lastField = field;
      }
      if (!seen.has("Description")) {
        offenders.push(
          `${name}:${currentFrLine + 1} ${currentFr}: missing mandatory ` +
            `field 'Description'`,
        );
      }
      if (!seen.has("Acceptance criteria") && !seen.has("Status")) {
        offenders.push(
          `${name}:${currentFrLine + 1} ${currentFr}: missing 'Acceptance ` +
            `criteria' (no 'Status' field present to mark the FR ` +
            `superseded/deprecated)`,
        );
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(frHeaderRe);
      if (headerMatch) {
        flush();
        currentFr = headerMatch[1];
        currentFrLine = i;
        frFields = [];
        continue;
      }
      const fieldMatch = line.match(fieldRe);
      if (fieldMatch && currentFr) {
        const field = fieldMatch[1].trim();
        frFields.push({ field, line: i });
      }
    }
    flush();
  }
  return offenders;
}

/**
 * Wrapper for `validateFrFields` that reads
 * `documents/requirements-{engine,sdlc}/*.md`. No-op when neither
 * directory exists (fresh end-user project may have no SRS yet).
 *
 * Currently NOT wired into the main check pipeline — the bulk of
 * existing FRs use legacy field shapes; the pure validator is
 * exercised by tests until the migration sweep completes (per
 * ADR-0012). After the sweep, append `await frFieldSet();` to
 * the main pipeline alongside `await adrSet();`.
 */
export async function frFieldSet(): Promise<void> {
  console.log("\n--- FR Canonical Field Set ---");
  const dirs = [
    "documents/requirements-engine",
    "documents/requirements-sdlc",
  ];
  const files: Array<{ name: string; content: string }> = [];
  for (const dir of dirs) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const content = await Deno.readTextFile(`${dir}/${entry.name}`);
        files.push({ name: `${dir}/${entry.name}`, content });
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  if (files.length === 0) {
    console.log("  No SRS section files found — skipped.");
    return;
  }
  const offenders = validateFrFields(files);
  if (offenders.length > 0) {
    for (const line of offenders) console.error(`  ${line}`);
    console.error(
      "FAILED: FR field-set lint — see ADR-0012 + documents/CLAUDE.md " +
        "§FR canonical field set.",
    );
    Deno.exit(1);
  }
  console.log(`  FR field set valid (${files.length} section file(s)).`);
}

/**
 * Wrapper for `validateAdrSet` that reads `documents/adrs/`. Skips
 * `README.md` and `_template.md`. No-op when the directory is absent
 * (fresh end-user project may not have ADRs yet — non-blocking).
 */
async function adrSet(): Promise<void> {
  console.log("\n--- ADR Set ---");
  const dir = "documents/adrs";
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(dir);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.log(`  No ${dir}/ directory — skipped.`);
      return;
    }
    throw err;
  }
  if (!stat.isDirectory) {
    console.error(`FAILED: ${dir} exists but is not a directory.`);
    Deno.exit(1);
  }
  const files: Array<{ name: string; content: string }> = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    if (entry.name === "README.md" || entry.name === "_template.md") continue;
    const content = await Deno.readTextFile(`${dir}/${entry.name}`);
    files.push({ name: entry.name, content });
  }
  const offenders = validateAdrSet(files);
  if (offenders.length > 0) {
    for (const line of offenders) console.error(`  ${line}`);
    console.error(
      "FAILED: ADR set lint — see documents/adrs/README.md for the format contract.",
    );
    Deno.exit(1);
  }
  console.log(`  ADR set valid (${files.length} record(s)).`);
}

/** Render the CLI help text for `deno task check`. */
export function printUsage(): string {
  return `Full project verification: fmt, lint, test, comment-scan

Usage:
  deno task check

Checks performed:
  - Formatting check (deno fmt --check)
  - Linting (deno lint)
  - Type check (deno check — all .ts files incl. tests)
  - CLI smoke test (cli.ts --help)
  - Secret scan (gitleaks)
  - Tests (deno test)
  - Doc lint: JSDoc, private-type-ref, circular deps (deno doc --lint)
  - Workflow integrity check
  - AGENTS.md agent list accuracy
  - HITL artifact_source template validation
  - Docs token budget (every documents/*.md fits in Read's 10k-token limit)
  - ADR set lint (numbering, required sections, status, cross-links)
  - Comment marker scan (TODO/FIXME/HACK/XXX)

No options accepted.

Example:
  deno task check`;
}

/**
 * Parse CLI arguments for `deno task check`.
 * Returns `{ text, code }` for `--help` (code 0) or any unknown argument
 * (code 1); returns `null` to signal "proceed with the full check".
 */
export function checkArgs(
  args: string[],
): { text: string; code: number } | null {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return { text: printUsage(), code: 0 };
    }
    return {
      text: `Error: Unknown argument: ${arg}. Use --help for usage.`,
      code: 1,
    };
  }
  return null;
}

if (import.meta.main) {
  const argCheck = checkArgs(Deno.args);
  if (argCheck !== null) {
    if (argCheck.code === 0) console.log(argCheck.text);
    else console.error(argCheck.text);
    Deno.exit(argCheck.code);
  }

  console.log("=== flowai-workflow: Full Check ===");

  await run("deno", ["fmt"], "Formatting (auto-fix)");
  await run("deno", ["lint"], "Linting");

  // Type check root-level .ts files, scripts/*.ts, and .claude/hooks/*.ts.
  // The ai-ide-cli library lives in a sibling repo and runs its own check
  // there; flowai-workflow imports it via JSR. `.claude/hooks/` is in
  // publish.exclude (so `deno publish --dry-run` skips it) — listing it
  // here is the only thing that type-checks Deno-based hooks. Missing
  // directory is silently skipped so end-user projects that lack
  // `.claude/hooks/` still pass.
  const typeCheckFiles: string[] = [];
  for (const dir of [".", "scripts", ".claude/hooks"]) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith(".ts")) {
          typeCheckFiles.push(
            dir === "." ? entry.name : `${dir}/${entry.name}`,
          );
        }
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  await run("deno", ["check", ...typeCheckFiles.sort()], "Type Check");

  // Smoke test: verify CLI entry point actually starts
  await run(
    "deno",
    ["run", "-A", "cli.ts", "--help"],
    "CLI Smoke Test",
  );

  await run("gitleaks", ["detect", "--no-git"], "Secret Scan");

  // "." recursively finds every *_test.ts in the repo (root engine
  // modules, scripts/, .flowai-workflow/, init/, …). Passing
  // overlapping paths would double-test the same files.
  // Ignore live git-worktree dirs (engine creates them per run; they
  // hold frozen copies of older test files that no longer reflect HEAD).
  // FR-E57 layout: `.flowai-workflow/<wf>/runs/<run-id>/worktree/`.
  if (await hasTestFiles(".")) {
    await run(
      "deno",
      [
        "test",
        "-A",
        "--no-check",
        "--ignore=.flowai-workflow/*/runs,.claude/worktrees",
        ".",
      ],
      "Tests",
    );
  } else {
    console.log("\n--- Tests ---");
    console.log("No test files found, skipping.");
  }

  // Doc lint: missing JSDoc, private-type-ref, circular deps.
  // Caveat: `deno doc --lint` validates ONLY symbols reachable from the
  // given entry. Public symbols exported via other barrels are not
  // visited — rely on `deno publish --dry-run` below for full coverage.
  await run("deno", ["doc", "--lint", "mod.ts"], "Doc Lint");

  // JSR publish dry-run — catches JSR `no-slow-types`, `missing-jsdoc`,
  // `private-type-ref`, and `invalid-path` errors that `deno check` and
  // `deno doc --lint` do NOT surface locally.
  await run(
    "deno",
    ["publish", "--dry-run", "--allow-dirty"],
    "Publish Dry-Run",
  );

  await workflowIntegrity();
  await noClaudeAgentsCheck();
  await hitlArtifactSource();
  await agentListAccuracy();
  await docsTokenBudget();
  await adrSet();
  await commentScan();

  console.log("\n=== All checks passed! ===");
}
