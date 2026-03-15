/**
 * @module
 * Full project verification: fmt --check, lint, type-check, CLI smoke test,
 * secret scan, tests, doc lint, pipeline integrity, AGENTS.md accuracy, and
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
  const process = new Deno.Command(cmd, {
    args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { success } = await process.output();
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
      entry.includes("node_modules") || entry.includes(".auto-flow/pipeline") ||
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

async function* walkDir(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory && !entry.name.startsWith(".")) {
      yield* walkDir(path);
    } else if (entry.isFile) {
      yield path;
    }
  }
}

async function pipelineIntegrity(): Promise<void> {
  console.log("\n--- Pipeline Integrity ---");
  const pipelinePath = ".auto-flow/pipeline.yaml";

  // 1. Load and validate pipeline config (schema + prompt paths + phases)
  const { loadConfig } = await import("../engine/config.ts");
  try {
    await loadConfig(pipelinePath);
    console.log(`  Pipeline config valid: ${pipelinePath}`);
  } catch (err) {
    console.error(`FAILED: Pipeline validation: ${(err as Error).message}`);
    Deno.exit(1);
  }

  // 2. Check agent symlinks in .claude/skills/ point to existing directories
  const skillsDir = ".claude/skills";
  const brokenLinks: string[] = [];
  try {
    for await (const entry of Deno.readDir(skillsDir)) {
      if (!entry.name.startsWith("agent-")) continue;
      const linkPath = `${skillsDir}/${entry.name}`;
      try {
        await Deno.stat(linkPath); // follows symlink, fails if target missing
      } catch {
        const target = await Deno.readLink(linkPath);
        brokenLinks.push(`${linkPath} -> ${target}`);
      }
    }
  } catch {
    console.warn(
      "  Warning: .claude/skills/ directory not found, skipping symlink check",
    );
  }

  if (brokenLinks.length > 0) {
    console.error(
      `FAILED: Broken agent symlinks:\n  - ${brokenLinks.join("\n  - ")}`,
    );
    Deno.exit(1);
  }
  console.log("  Agent symlinks valid.");
}

/**
 * Validates AGENTS.md content for agent list accuracy.
 *
 * Checks that the Project Vision section lists all 6 active pipeline agents
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
  const deprecatedAgents = ["Presenter", "Reviewer", "SDS Update"];
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
  - Pipeline integrity check
  - AGENTS.md agent list accuracy
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

  console.log("=== auto-flow: Full Check ===");

  await run("deno", ["fmt", "--check"], "Formatting Check");
  await run("deno", ["lint"], "Linting");

  // Type check all .ts files (source + tests) in engine/ and scripts/
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

  const testDirs = ["scripts", ".auto-flow", "engine"];
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

  // Doc lint: missing JSDoc, private-type-ref, circular deps
  await run(
    "deno",
    ["doc", "--lint", "engine/mod.ts"],
    "Doc Lint",
  );

  await pipelineIntegrity();
  await agentListAccuracy();
  await commentScan();

  console.log("\n=== All checks passed! ===");
}
