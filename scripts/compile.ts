#!/usr/bin/env -S deno run -A
/**
 * Cross-platform compile script for auto-flow.
 * Produces standalone binaries via `deno compile` for each supported target.
 *
 * Usage:
 *   deno task compile                    # Build all 4 targets
 *   deno task compile --target <triple>  # Build a single target
 *
 * Supported targets:
 *   x86_64-unknown-linux-gnu   → auto-flow-linux-amd64
 *   aarch64-unknown-linux-gnu  → auto-flow-linux-arm64
 *   x86_64-apple-darwin        → auto-flow-macos-amd64
 *   aarch64-apple-darwin       → auto-flow-macos-arm64
 *
 * The VERSION env var is embedded at compile time (defaults to "dev").
 */

interface Target {
  triple: string;
  name: string;
}

const TARGETS: Target[] = [
  { triple: "x86_64-unknown-linux-gnu", name: "auto-flow-linux-amd64" },
  { triple: "aarch64-unknown-linux-gnu", name: "auto-flow-linux-arm64" },
  { triple: "x86_64-apple-darwin", name: "auto-flow-macos-amd64" },
  { triple: "aarch64-apple-darwin", name: "auto-flow-macos-arm64" },
];

const cliArgs = Deno.args;
const targetIdx = cliArgs.indexOf("--target");
const version = Deno.env.get("VERSION") ?? "dev";

// Determine which targets to build
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

// Write a temp env file so VERSION is embedded by deno compile
const tmpEnvFile = await Deno.makeTempFile({ suffix: ".env" });
try {
  await Deno.writeTextFile(tmpEnvFile, `VERSION=${version}\n`);

  for (const { triple, name } of targets) {
    console.log(`Compiling ${name} (${triple})...`);
    const cmd = new Deno.Command("deno", {
      args: [
        "compile",
        "--allow-all",
        "--target",
        triple,
        "--env-file",
        tmpEnvFile,
        "--output",
        name,
        "engine/cli.ts",
      ],
    });
    const { success } = await cmd.output();
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
