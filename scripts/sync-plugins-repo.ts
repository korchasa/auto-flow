#!/usr/bin/env -S deno run -A
/**
 * @module
 * Sync the plugin payload built by {@link buildPluginPayload} into the
 * downstream `korchasa/flowai-workflow-plugins` repo (FR-E72).
 *
 * Three modes (selected by `--mode`):
 *
 * - **publish** (CI default): clone the target repo, build the payload
 *   into it via {@link buildPluginPayload}, commit + tag + push. The
 *   commit is idempotent — if the working tree is byte-equal to HEAD,
 *   no commit/tag/push happens (FR-E72 idempotency contract).
 * - **dry-run** (local default): build the payload into `--out-dir`
 *   for human inspection. No git ops. Replaces the legacy
 *   `deno task sync-claude-plugin` build step.
 * - **install-local**: build to a temp dir, then register that dir as
 *   a Claude Code marketplace at user scope and install / update the
 *   plugin. Restores the dogfood UX that `deno task sync-claude-plugin`
 *   used to provide. Missing `claude` CLI is a soft skip, not a fatal
 *   error, mirroring the previous tool's behaviour.
 *
 * The script is structured around an injection-point `SyncDeps` object so
 * the test suite can mock `git` and `claude` invocations without spawning
 * subprocesses. Production callers leave `deps` unset.
 */

import { dirname, isAbsolute, join, resolve } from "@std/path";
import { buildPluginPayload } from "./build-plugin-payload.ts";

/** Default downstream marketplace repo (FR-E72). */
export const TARGET_REPO = "korchasa/flowai-workflow-plugins";

/** Modes supported by the script. */
export type SyncMode = "publish" | "dry-run" | "install-local";

/** Required inputs for a sync run. */
export interface SyncOptions {
  /** Absolute path to the engine repo root. */
  engineRoot: string;
  /** Version string pinned into the payload manifests and the new tag. */
  version: string;
  /** Operation mode. */
  mode: SyncMode;
  /**
   * Output directory for `dry-run` mode (`dist/plugin-payload` by
   * default). Ignored in other modes.
   */
  outDir?: string;
  /**
   * Auth token for `git push` in `publish` mode. Read from
   * `PLUGINS_REPO_TOKEN` if unset; required for `publish`, ignored for
   * other modes. The token is interpolated into the clone URL via
   * `https://x-access-token:<token>@github.com/<repo>`.
   */
  token?: string;
  /** Override for the target repo slug. Defaults to {@link TARGET_REPO}. */
  targetRepo?: string;
}

/** Captured outcome of a single git invocation. */
export interface GitOutput {
  success: boolean;
  stdout: string;
  stderr: string;
}

/** Captured outcome of a single claude invocation. */
export interface ClaudeOutput {
  success: boolean;
  stdout: string;
  stderr: string;
}

/** Injection points for testing. Production code uses real subprocesses. */
export interface SyncDeps {
  /**
   * Run `git <args>`. The optional `cwd` selects the working directory
   * (used for ops inside the clone of the target repo).
   */
  runGit?: (args: string[], opts?: { cwd?: string }) => Promise<GitOutput>;
  /**
   * Run `claude <args>`. Optional — used only in `install-local` mode.
   * When `null` is returned (mocked-absent CLI), the caller soft-skips.
   */
  runClaude?: (args: string[]) => Promise<ClaudeOutput | null>;
  /** Build the payload. Tests inject a fake to avoid file I/O. */
  buildPayload?: typeof buildPluginPayload;
  /** Return an empty temp dir. Tests inject deterministic paths. */
  makeTempDir?: (prefix: string) => Promise<string>;
  /**
   * Remove a directory recursively. Tests pass a no-op to avoid touching
   * the real filesystem.
   */
  removeDir?: (path: string) => Promise<void>;
}

/** Final report from one sync. */
export interface SyncResult {
  mode: SyncMode;
  /** Path that was populated with the payload. */
  payloadDir: string;
  /** Number of files written by the build step. */
  filesWritten: number;
  /** True when the target repo's working tree changed (commit issued). */
  changed: boolean;
  /** Tag pushed in `publish` mode; `null` otherwise. */
  tag: string | null;
  /** True when an install-local run had to soft-skip (missing claude). */
  claudeMissing: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — easily covered by unit tests.
// ---------------------------------------------------------------------------

/**
 * Build the authenticated git clone URL for a `owner/repo` slug.
 * Pure — used in `publish` mode only. The token is embedded inline so
 * `git clone` does not need an external credential helper.
 */
export function buildCloneUrl(targetRepo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${targetRepo}.git`;
}

/**
 * Inspect `git status --porcelain` output to decide if the working tree
 * differs from HEAD. Empty / whitespace-only output means "no change";
 * anything else means "commit needed".
 *
 * Pure — used by both production code and tests.
 */
export function workingTreeIsDirty(porcelain: string): boolean {
  return porcelain.split("\n").some((line) => line.trim().length > 0);
}

/**
 * Build the commit message used in `publish` mode. The format embeds
 * the engine source SHA (provided by the caller) for traceability.
 *
 * Pure — exported for tests + CLI smoke.
 */
export function commitMessage(version: string, engineSha: string): string {
  return `release: v${version} (synced from engine@${engineSha.slice(0, 12)})`;
}

// ---------------------------------------------------------------------------
// Default dependency wiring.
// ---------------------------------------------------------------------------

async function defaultRunGit(
  args: string[],
  opts?: { cwd?: string },
): Promise<GitOutput> {
  const out = await new Deno.Command("git", {
    args,
    cwd: opts?.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: out.success,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function defaultRunClaude(
  args: string[],
): Promise<ClaudeOutput | null> {
  try {
    const out = await new Deno.Command("claude", {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      success: out.success,
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

const defaultMakeTempDir = (prefix: string) => Deno.makeTempDir({ prefix });

async function defaultRemoveDir(path: string): Promise<void> {
  await Deno.remove(path, { recursive: true }).catch((err) => {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  });
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function dryRunMode(
  opts: SyncOptions,
  deps: Required<Pick<SyncDeps, "buildPayload">>,
): Promise<SyncResult> {
  const payloadDir = resolve(opts.outDir ?? "dist/plugin-payload");
  const result = await deps.buildPayload({
    engineRoot: opts.engineRoot,
    version: opts.version,
    outDir: payloadDir,
  });
  return {
    mode: "dry-run",
    payloadDir,
    filesWritten: result.filesWritten.length,
    changed: false,
    tag: null,
    claudeMissing: false,
  };
}

async function installLocalMode(
  opts: SyncOptions,
  deps: Required<
    Pick<SyncDeps, "buildPayload" | "runClaude" | "makeTempDir">
  >,
): Promise<SyncResult> {
  const payloadDir = await deps.makeTempDir("flowai-plugin-payload-");
  const buildResult = await deps.buildPayload({
    engineRoot: opts.engineRoot,
    version: opts.version,
    outDir: payloadDir,
  });
  // marketplace add expects the directory that holds .claude-plugin/.
  const marketplaceName = "flowai-workflow";
  // Remove any prior marketplace with the same name so updates re-resolve
  // against the freshly-built tree. Failure (no such marketplace) is
  // expected on first install; ignore the exit code.
  await deps.runClaude([
    "plugin",
    "marketplace",
    "remove",
    marketplaceName,
  ]);
  const addResult = await deps.runClaude([
    "plugin",
    "marketplace",
    "add",
    payloadDir,
  ]);
  if (addResult === null) {
    // claude CLI not present — soft skip per FR-E72 install-local contract.
    return {
      mode: "install-local",
      payloadDir,
      filesWritten: buildResult.filesWritten.length,
      changed: false,
      tag: null,
      claudeMissing: true,
    };
  }
  if (!addResult.success) {
    throw new Error(
      `claude plugin marketplace add failed: ${addResult.stderr.trim()}`,
    );
  }
  const installResult = await deps.runClaude([
    "plugin",
    "install",
    `flowai-workflow@${marketplaceName}`,
    "--scope",
    "user",
  ]);
  if (installResult && !installResult.success) {
    // install may fail when already installed; try update instead.
    const updateResult = await deps.runClaude([
      "plugin",
      "update",
      `flowai-workflow@${marketplaceName}`,
      "--scope",
      "user",
    ]);
    if (updateResult && !updateResult.success) {
      throw new Error(
        `claude plugin install/update failed: ${updateResult.stderr.trim()}`,
      );
    }
  }
  return {
    mode: "install-local",
    payloadDir,
    filesWritten: buildResult.filesWritten.length,
    changed: true,
    tag: null,
    claudeMissing: false,
  };
}

async function publishMode(
  opts: SyncOptions,
  deps: Required<
    Pick<SyncDeps, "buildPayload" | "runGit" | "makeTempDir" | "removeDir">
  >,
): Promise<SyncResult> {
  const token = opts.token ?? Deno.env.get("PLUGINS_REPO_TOKEN") ?? "";
  if (!token) {
    throw new Error(
      "publish mode requires --token <pat> or PLUGINS_REPO_TOKEN env var.",
    );
  }
  const targetRepo = opts.targetRepo ?? TARGET_REPO;
  const cloneUrl = buildCloneUrl(targetRepo, token);

  const cloneDir = await deps.makeTempDir("flowai-plugins-clone-");
  try {
    // Clone target. --depth=1 keeps CI fast; we tag on top of main so
    // no historical commits are needed.
    const clone = await deps.runGit([
      "clone",
      "--depth=1",
      cloneUrl,
      cloneDir,
    ]);
    if (!clone.success) {
      throw new Error(`git clone ${targetRepo} failed: ${clone.stderr.trim()}`);
    }

    // Pin a deterministic identity for `commit` AND `tag -a` in the
    // freshly-cloned repo. Setting it via per-invocation `-c` covers
    // `commit` but NOT `tag -a` (tag uses TAGGER_* env or git config;
    // there is no `-c` overlay for the tagger). One-shot `git config`
    // inside the clone is scoped to the clone — no side effect on the
    // CI runner's other git work.
    await mustGit(
      deps.runGit,
      ["config", "user.email", "github-actions[bot]@users.noreply.github.com"],
      cloneDir,
    );
    await mustGit(
      deps.runGit,
      ["config", "user.name", "github-actions[bot]"],
      cloneDir,
    );

    // Find the engine SHA before any working-tree mutation so the
    // commit message records exactly what produced the payload.
    const shaOut = await deps.runGit(
      ["rev-parse", "HEAD"],
      { cwd: opts.engineRoot },
    );
    if (!shaOut.success) {
      throw new Error(
        `git rev-parse HEAD in ${opts.engineRoot} failed: ${shaOut.stderr.trim()}`,
      );
    }
    const engineSha = shaOut.stdout.trim();

    // Build the new payload directly into the clone, OVERWRITING any
    // prior files. buildPluginPayload already truncates the target dir
    // — but we must preserve `.git/` inside the clone.
    const stagingDir = await deps.makeTempDir("flowai-plugins-staging-");
    const buildResult = await deps.buildPayload({
      engineRoot: opts.engineRoot,
      version: opts.version,
      outDir: stagingDir,
    });
    // Replace clone contents (except .git/) with staging contents.
    await syncDirectoryContents(stagingDir, cloneDir);
    await deps.removeDir(stagingDir);

    // Detect whether anything actually changed; if not, exit clean.
    const status = await deps.runGit(
      ["status", "--porcelain"],
      { cwd: cloneDir },
    );
    if (!status.success) {
      throw new Error(`git status in clone failed: ${status.stderr.trim()}`);
    }
    if (!workingTreeIsDirty(status.stdout)) {
      console.error(
        `[sync-plugins] No payload change for v${opts.version}; skipping commit/push.`,
      );
      return {
        mode: "publish",
        payloadDir: cloneDir,
        filesWritten: buildResult.filesWritten.length,
        changed: false,
        tag: null,
        claudeMissing: false,
      };
    }

    // Commit + tag + push. Identity is pinned via `git config` above so
    // both `commit` and `tag -a` pick up the same tagger.
    await mustGit(deps.runGit, ["add", "-A"], cloneDir);
    await mustGit(
      deps.runGit,
      ["commit", "-m", commitMessage(opts.version, engineSha)],
      cloneDir,
    );
    const tag = `v${opts.version}`;
    await mustGit(
      deps.runGit,
      ["tag", "-a", tag, "-m", `Release ${tag}`],
      cloneDir,
    );
    await mustGit(
      deps.runGit,
      ["push", "origin", "HEAD:main", tag],
      cloneDir,
    );

    return {
      mode: "publish",
      payloadDir: cloneDir,
      filesWritten: buildResult.filesWritten.length,
      changed: true,
      tag,
      claudeMissing: false,
    };
  } finally {
    // Always try to clean up the clone; failures here are noise.
    await deps.removeDir(cloneDir);
  }
}

/** Run git and throw on failure with the stderr inlined into the error. */
async function mustGit(
  runGit: NonNullable<SyncDeps["runGit"]>,
  args: string[],
  cwd: string,
): Promise<GitOutput> {
  const out = await runGit(args, { cwd });
  if (!out.success) {
    throw new Error(
      `git ${args.join(" ")} (cwd=${cwd}) failed: ${out.stderr.trim()}`,
    );
  }
  return out;
}

/**
 * Replace the contents of `dst` (preserving `.git/`) with the contents
 * of `src`. Used by `publish` mode to mirror the freshly-built payload
 * into the clone of the downstream repo. Internal — exposed only via
 * the publishMode happy path.
 */
async function syncDirectoryContents(src: string, dst: string): Promise<void> {
  // Step 1: wipe everything in dst except .git/ so deleted source files
  // get removed in the next commit. Without this, removed bundled
  // workflows would silently linger in the downstream repo.
  for await (const entry of Deno.readDir(dst)) {
    if (entry.name === ".git") continue;
    await Deno.remove(join(dst, entry.name), { recursive: true });
  }
  // Step 2: copy src tree into dst.
  await copyRecursive(src, dst);
}

async function copyRecursive(src: string, dst: string): Promise<void> {
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory) {
      await Deno.mkdir(dstPath, { recursive: true });
      await copyRecursive(srcPath, dstPath);
    } else {
      await Deno.mkdir(dirname(dstPath), { recursive: true });
      await Deno.copyFile(srcPath, dstPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Top-level entry
// ---------------------------------------------------------------------------

/**
 * Run a sync. Production code calls this with `deps = {}` and the
 * default subprocess wiring fills in; tests pass mocks to assert exact
 * command sequences without spawning anything.
 */
export function syncPluginsRepo(
  opts: SyncOptions,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const wired: Required<SyncDeps> = {
    runGit: deps.runGit ?? defaultRunGit,
    runClaude: deps.runClaude ?? defaultRunClaude,
    buildPayload: deps.buildPayload ?? buildPluginPayload,
    makeTempDir: deps.makeTempDir ?? defaultMakeTempDir,
    removeDir: deps.removeDir ?? defaultRemoveDir,
  };
  switch (opts.mode) {
    case "dry-run":
      return dryRunMode(opts, wired);
    case "install-local":
      return installLocalMode(opts, wired);
    case "publish":
      return publishMode(opts, wired);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  engineRoot: string;
  version: string;
  mode: SyncMode;
  outDir?: string;
  token?: string;
  targetRepo?: string;
}

/** Parse CLI args. Exported for tests. */
export function parseSyncCliArgs(argv: string[]): CliArgs | { help: string } {
  let engineRoot = ".";
  let version = "";
  let mode: SyncMode = "publish";
  let outDir: string | undefined;
  let token: string | undefined;
  let targetRepo: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--engine-root":
        engineRoot = argv[++i] ?? "";
        break;
      case "--version":
        version = argv[++i] ?? "";
        break;
      case "--mode": {
        const m = argv[++i] ?? "";
        if (m !== "publish" && m !== "dry-run" && m !== "install-local") {
          throw new Error(
            `--mode must be one of: publish, dry-run, install-local (got '${m}')`,
          );
        }
        mode = m;
        break;
      }
      case "--dry-run":
        mode = "dry-run";
        break;
      case "--install-local":
        mode = "install-local";
        break;
      case "--out-dir":
        outDir = argv[++i];
        break;
      case "--token":
        token = argv[++i];
        break;
      case "--target-repo":
        targetRepo = argv[++i];
        break;
      case "-h":
      case "--help":
        return {
          help: [
            "Usage: sync-plugins-repo --version <semver> [--mode <publish|dry-run|install-local>]",
            "                         [--out-dir <dir>] [--token <pat>] [--target-repo <owner/repo>]",
            "                         [--engine-root <dir>]",
            "Defaults: --mode publish, --engine-root .,",
            "          --target-repo korchasa/flowai-workflow-plugins.",
            "publish mode also reads $PLUGINS_REPO_TOKEN.",
          ].join("\n"),
        };
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!version) {
    // Try to read from deno.json so CI can pass --version "${GITHUB_REF_NAME#v}"
    // OR rely on the default for local dry-runs.
    try {
      const deno = JSON.parse(Deno.readTextFileSync("deno.json")) as {
        version?: string;
      };
      if (deno.version) version = deno.version;
    } catch {
      // ignore
    }
  }
  if (!version) {
    throw new Error("--version is required (or set in deno.json#version).");
  }
  return { engineRoot, version, mode, outDir, token, targetRepo };
}

if (import.meta.main) {
  let parsed: CliArgs | { help: string };
  try {
    parsed = parseSyncCliArgs(Deno.args);
  } catch (err) {
    console.error((err as Error).message);
    Deno.exit(2);
  }
  if ("help" in parsed) {
    console.log(parsed.help);
    Deno.exit(0);
  }
  const result = await syncPluginsRepo(parsed);
  switch (result.mode) {
    case "dry-run":
      console.log(
        `[dry-run] Built ${result.filesWritten} files into ${
          isAbsolute(result.payloadDir)
            ? result.payloadDir
            : resolve(result.payloadDir)
        }.`,
      );
      break;
    case "install-local":
      if (result.claudeMissing) {
        console.log(
          `[install-local] claude CLI not found; built payload at ${result.payloadDir} ` +
            `but skipped marketplace registration.`,
        );
      } else {
        console.log(
          `[install-local] Built ${result.filesWritten} files; registered ` +
            `marketplace + installed plugin from ${result.payloadDir}.`,
        );
      }
      break;
    case "publish":
      if (result.changed) {
        console.log(
          `[publish] Pushed ${result.filesWritten} files and tag ${result.tag} ` +
            `to downstream repo.`,
        );
      } else {
        console.log(
          `[publish] No payload change for v${parsed.version}; nothing pushed.`,
        );
      }
      break;
  }
}
