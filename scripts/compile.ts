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
 *
 * **Workflow bundling.** `deno compile` only auto-embeds statically-imported
 * `.ts/.js` modules. The bundled SDLC workflows under `.flowai-workflow/`
 * are arbitrary data files (YAML / Markdown / shell), so they have to be
 * passed explicitly via repeated `--include`. This script enumerates the
 * tracked-and-existing files via `git ls-files .flowai-workflow/`, which
 * mirrors the publish-clean set in `deno.json#publish.exclude` and
 * automatically skips per-run dirt (`runs/`, `memory/agent-*.md`,
 * deleted-but-tracked files like a stale `.template.json`). Every binary
 * therefore ships the same workflow folders the project itself dogfoods.
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

/**
 * Enumerate `.flowai-workflow/` files to bundle into the compiled binary.
 *
 * Uses `git ls-files` so the result mirrors what JSR ships and excludes
 * gitignored per-run dirt. Filters out tracked-but-deleted entries (those
 * exist in the index after a `rm` before commit, and would crash
 * `deno compile`).
 *
 * Returns sorted paths relative to the repo root. Throws on any git or
 * I/O failure — silent fallback would produce binaries that pass `deno
 * compile` but fail at runtime when init looks for bundled workflows.
 */
export async function discoverBundledWorkflowFiles(): Promise<string[]> {
  const proc = new Deno.Command("git", {
    args: ["ls-files", "-z", ".flowai-workflow/"],
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stdout, stderr } = await proc.output();
  if (!success) {
    throw new Error(
      `git ls-files .flowai-workflow/ failed: ${
        new TextDecoder().decode(stderr)
      }`,
    );
  }
  const tracked = new TextDecoder()
    .decode(stdout)
    .split("\0")
    .filter((p) => p.length > 0);
  const existing: string[] = [];
  for (const path of tracked) {
    try {
      const stat = await Deno.stat(path);
      if (stat.isFile) existing.push(path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
  }
  existing.sort();
  return existing;
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

  // Enumerate workflow files once — same set for every target.
  const bundledFiles = await discoverBundledWorkflowFiles();
  if (bundledFiles.length === 0) {
    console.error(
      "No `.flowai-workflow/` files found via `git ls-files`. " +
        "The compiled binary would have zero bundled workflows — " +
        "refusing to build. Run from the repo root.",
    );
    Deno.exit(1);
  }
  console.log(
    `Bundling ${bundledFiles.length} files from .flowai-workflow/ ` +
      `(${countWorkflowFolders(bundledFiles)} workflows).`,
  );

  // Write .env in CWD for deno compile --env-file (must be unnamed .env,
  // explicit paths trigger a Deno bug that parses the file as a JS module).
  const envFile = ".env";
  const hadEnvFile = await fileExists(envFile);
  const prevContent = hadEnvFile ? await Deno.readTextFile(envFile) : undefined;

  try {
    await Deno.writeTextFile(envFile, `VERSION=${version}\n`);

    const includeArgs: string[] = bundledFiles.flatMap((f) => ["--include", f]);

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
          ...includeArgs,
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

/** Count distinct workflow folders represented in a list of bundled files. */
function countWorkflowFolders(files: string[]): number {
  const folders = new Set<string>();
  for (const f of files) {
    const m = f.match(/^\.flowai-workflow\/([^/]+)\//);
    if (m) folders.add(m[1]);
  }
  return folders.size;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
