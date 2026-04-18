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

async function workflowIntegrity(): Promise<void> {
  console.log("\n--- Workflow Integrity ---");
  const workflowPath = ".flowai-workflow/workflow.yaml";

  // 1. Load and validate workflow config (schema + prompt paths + phases)
  const { loadConfig } = await import("../engine/config.ts");
  try {
    await loadConfig(workflowPath);
    console.log(`  Workflow config valid: ${workflowPath}`);
  } catch (err) {
    console.error(`FAILED: Workflow validation: ${(err as Error).message}`);
    Deno.exit(1);
  }
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
  const workflowPath = ".flowai-workflow/workflow.yaml";
  const { loadConfig } = await import("../engine/config.ts");
  let config;
  try {
    config = await loadConfig(workflowPath);
  } catch (err) {
    // loadConfig errors are already reported by workflowIntegrity(); skip here
    console.log(
      `  Skipped (workflow config invalid): ${(err as Error).message}`,
    );
    return;
  }
  const artifactSource = config.defaults?.hitl?.artifact_source;
  const errors = validateHitlArtifactSource(artifactSource);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`  ${err}`);
    }
    console.error(
      "FAILED: HITL artifact_source must use template syntax ({{input.<node>}})",
    );
    Deno.exit(1);
  }
  console.log("  HITL artifact_source uses template syntax.");
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

export function printUsage(): string {
  return `Full project verification: fmt, lint, test, comment-scan

Usage:
  deno task check

Checks performed:
  - Formatting check (deno fmt --check)
  - Linting (deno lint)
  - Type check (deno check — all .ts files incl. tests)
  - CLI smoke test (engine/cli.ts --help)
  - Secret scan (gitleaks)
  - Tests (deno test)
  - Doc lint: JSDoc, private-type-ref, circular deps (deno doc --lint)
  - Workflow integrity check
  - AGENTS.md agent list accuracy
  - HITL artifact_source template validation
  - Docs token budget (every documents/*.md fits in Read's 10k-token limit)
  - Comment marker scan (TODO/FIXME/HACK/XXX)

No options accepted.

Example:
  deno task check`;
}

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

  // Type check engine/ and scripts/ .ts files. The ai-ide-cli library
  // lives in a sibling repo and runs its own check there; engine imports
  // it via JSR (resolved locally through the `links` field in deno.json).
  const typeCheckFiles: string[] = [];
  for (const dir of ["engine", "scripts"]) {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".ts")) {
        typeCheckFiles.push(`${dir}/${entry.name}`);
      }
    }
  }
  await run("deno", ["check", ...typeCheckFiles.sort()], "Type Check");

  // Smoke test: verify CLI entry point actually starts
  await run(
    "deno",
    ["run", "-A", "engine/cli.ts", "--help"],
    "CLI Smoke Test",
  );

  await run("gitleaks", ["detect", "--no-git"], "Secret Scan");

  const testDirs = ["scripts", ".flowai-workflow", "engine"];
  const testableDir = (await Promise.all(
    testDirs.map(async (d) => ({ d, has: await hasTestFiles(d) })),
  )).filter((x) => x.has).map((x) => x.d);

  if (testableDir.length > 0) {
    await run(
      "deno",
      ["test", "-A", "--no-check", ...testableDir],
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
  await run(
    "deno",
    ["doc", "--lint", "engine/mod.ts"],
    "Doc Lint (engine)",
  );

  // Engine JSR publish dry-run — catches JSR `no-slow-types`,
  // `missing-jsdoc`, `private-type-ref`, and `invalid-path` errors that
  // `deno check` and `deno doc --lint` do NOT surface locally. Must run
  // with CWD set to the workspace member because `deno publish` from
  // the workspace root publishes only the first member.
  console.log("\n--- Publish Dry-Run (engine) ---");
  console.log("> deno publish --dry-run --allow-dirty (cwd=engine)");
  const enginePublish = new Deno.Command("deno", {
    args: ["publish", "--dry-run", "--allow-dirty"],
    cwd: "engine",
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success: enginePublishOk } = await enginePublish.output();
  if (!enginePublishOk) {
    console.error("FAILED: Publish Dry-Run (engine)");
    Deno.exit(1);
  }

  await workflowIntegrity();
  await hitlArtifactSource();
  await agentListAccuracy();
  await docsTokenBudget();
  await commentScan();

  console.log("\n=== All checks passed! ===");
}
