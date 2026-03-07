// scripts/check.ts
// Full project verification: fmt, lint, test, comment-scan

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
      entry.includes("node_modules") || entry.includes(".sdlc/pipeline") ||
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
    console.warn("Warning: found comment markers (non-blocking)");
  } else {
    console.log("No comment markers found.");
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

console.log("=== auto-flow: Full Check ===");

await run("deno", ["fmt", "--check"], "Formatting Check");
await run("deno", ["lint"], "Linting");
// Allow test failure when no test files exist yet
// Scope tests to project dirs (exclude .claude/skills/ which may need network)
const testDirs = ["scripts", ".sdlc"];
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
await commentScan();

console.log("\n=== All checks passed! ===");
