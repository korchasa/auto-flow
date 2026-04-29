#!/usr/bin/env -S deno run -A
/**
 * Cross-platform compile script for flowai-workflow.
 * Produces standalone binaries via `deno compile` for each supported target.
 *
 * Usage:
 *   deno task compile                    # Build all targets
 *   deno task compile --target <triple>  # Build a single target
 *
 * Supported targets are loaded from `scripts/targets.json` — the single
 * source of truth shared with `.github/workflows/ci.yml`. To add/remove
 * a platform, edit that file.
 *
 * The VERSION env var is embedded at compile time (defaults to "dev").
 * Leading "v" prefix is stripped (e.g., tag "v1.2.3" embeds as "1.2.3").
 */

import targetsData from "./targets.json" with { type: "json" };

/**
 * Single compile target.
 * Field names deliberately match GitHub Actions matrix conventions
 * (`matrix.target`, `matrix.artifact`) so the same JSON feeds both
 * this script and `.github/workflows/ci.yml` via `fromJSON`.
 */
export interface Target {
  /** Rust-style triple passed to `deno compile --target`. */
  target: string;
  /** Output filename for the compiled binary. */
  artifact: string;
}

/** Single source of truth: loaded from `scripts/targets.json`. */
export const TARGETS: Target[] = targetsData as Target[];

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
    ? TARGETS.filter((t) => t.target === cliArgs[targetIdx + 1])
    : TARGETS;

  if (targetIdx !== -1 && targets.length === 0) {
    const requested = cliArgs[targetIdx + 1];
    console.error(`Unknown target: ${requested}`);
    console.error(
      `Supported targets: ${TARGETS.map((t) => t.target).join(", ")}`,
    );
    Deno.exit(1);
  }

  // Write .env in CWD for deno compile --env-file (must be unnamed .env,
  // explicit paths trigger a Deno bug that parses the file as a JS module).
  const envFile = ".env";
  const hadEnvFile = await fileExists(envFile);
  const prevContent = hadEnvFile ? await Deno.readTextFile(envFile) : undefined;

  try {
    await Deno.writeTextFile(envFile, `VERSION=${version}\n`);

    for (const { target, artifact } of targets) {
      console.log(`Compiling ${artifact} (${target})...`);
      const cmd = new Deno.Command("deno", {
        args: [
          "compile",
          "--allow-all",
          "--no-check",
          "--target",
          target,
          "--env-file",
          "--output",
          artifact,
          "cli.ts",
        ],
        stdout: "inherit",
        stderr: "inherit",
      });
      const { success } = await cmd.spawn().status;
      if (!success) {
        console.error(`Compile failed for target: ${target}`);
        Deno.exit(1);
      }
      console.log(`  → ${artifact}`);
    }
  } finally {
    // Restore or remove .env
    if (prevContent !== undefined) {
      await Deno.writeTextFile(envFile, prevContent);
    } else {
      await Deno.remove(envFile).catch(() => {});
    }
  }

  console.log("Done.");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
