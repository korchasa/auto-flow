#!/usr/bin/env -S deno run -A
/**
 * Cross-platform compile script for flowai-workflow.
 * Produces standalone binaries via `deno compile` for each supported target.
 *
 * Usage:
 *   deno task compile                    # Build all 4 targets
 *   deno task compile --target <triple>  # Build a single target
 *
 * Supported targets:
 *   x86_64-unknown-linux-gnu   → flowai-workflow-linux-x86_64
 *   aarch64-unknown-linux-gnu  → flowai-workflow-linux-arm64
 *   x86_64-apple-darwin        → flowai-workflow-darwin-x86_64
 *   aarch64-apple-darwin       → flowai-workflow-darwin-arm64
 *
 * The VERSION env var is embedded at compile time (defaults to "dev").
 * Leading "v" prefix is stripped (e.g., tag "v1.2.3" embeds as "1.2.3").
 */

export interface Target {
  triple: string;
  name: string;
}

export const TARGETS: Target[] = [
  { triple: "x86_64-unknown-linux-gnu", name: "flowai-workflow-linux-x86_64" },
  { triple: "aarch64-unknown-linux-gnu", name: "flowai-workflow-linux-arm64" },
  { triple: "x86_64-apple-darwin", name: "flowai-workflow-darwin-x86_64" },
  { triple: "aarch64-apple-darwin", name: "flowai-workflow-darwin-arm64" },
];

/** Strip leading "v" prefix from a version tag (e.g., "v1.2.3" → "1.2.3"). */
export function stripVersionPrefix(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

if (import.meta.main) {
  await run();
}

async function run(): Promise<void> {
  const cliArgs = Deno.args;
  const targetIdx = cliArgs.indexOf("--target");
  const version = stripVersionPrefix(Deno.env.get("VERSION") ?? "dev");

  const targets: Target[] = targetIdx !== -1
    ? TARGETS.filter((t) => t.triple === cliArgs[targetIdx + 1])
    : TARGETS;

  if (targetIdx !== -1 && targets.length === 0) {
    const requested = cliArgs[targetIdx + 1];
    console.error(`Unknown target: ${requested}`);
    console.error(
      `Supported targets: ${TARGETS.map((t) => t.triple).join(", ")}`,
    );
    Deno.exit(1);
  }

  const tmpEnvFile = await Deno.makeTempFile({ suffix: ".env" });
  try {
    await Deno.writeTextFile(tmpEnvFile, `VERSION=${version}\n`);

    for (const { triple, name } of targets) {
      console.log(`Compiling ${name} (${triple})...`);
      const cmd = new Deno.Command("deno", {
        args: [
          "compile",
          "--allow-all",
          "--no-check",
          "--target",
          triple,
          "--env-file",
          tmpEnvFile,
          "--output",
          name,
          "engine/cli.ts",
        ],
        stdout: "inherit",
        stderr: "inherit",
      });
      const { success } = await cmd.spawn().status;
      if (!success) {
        console.error(`Compile failed for target: ${triple}`);
        Deno.exit(1);
      }
      console.log(`  → ${name}`);
    }
  } finally {
    await Deno.remove(tmpEnvFile);
  }

  console.log("Done.");
}
