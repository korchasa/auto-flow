/**
 * @module
 * Git worktree lifecycle management for per-run isolation.
 * Each workflow run executes in its own worktree, eliminating destructive
 * `git reset --hard` and enabling future parallel runs.
 *
 * FR-E57 layout: a run's worktree lives at
 * `<workflowDir>/runs/<run-id>/worktree/`, sibling to its `state.json` and
 * per-node artifact directories under the same `runs/<run-id>/` parent.
 * The pre-FR-E57 repo-global location `.flowai-workflow/worktrees/<run-id>`
 * remains as a one-release legacy-resume fallback inside `worktreeExists`
 * and `resolveExistingWorktreePath`; new worktrees are never created at it.
 */

/**
 * Pre-FR-E57 repo-global worktree base. Retained ONLY as a legacy-resume
 * fallback inside `worktreeExists` / `resolveExistingWorktreePath` so that
 * an in-flight run started on the old layout survives a binary upgrade.
 * Slated for removal in a follow-up FR — never write here.
 */
const LEGACY_WORKTREE_BASE = ".flowai-workflow/worktrees";

/**
 * Get the worktree path for a given run ID under `workflowDir`.
 *
 * Returns `<workflowDir>/runs/<runId>/worktree`. The `workflowDir` parameter
 * mirrors the same value threaded into `getRunDir`/`getNodeDir`/
 * `defaultLockPath` (FR-E54), so all per-run filesystem state lives under
 * one `<workflowDir>/runs/<runId>/` umbrella.
 */
export function getWorktreePath(runId: string, workflowDir: string): string {
  return `${workflowDir}/runs/${runId}/worktree`;
}

/**
 * Create a git worktree for a workflow run.
 * 1. Fetches latest from origin (fail fast on network error).
 * 2. Ensures `<workflowDir>/runs/<runId>/` parent exists (`git worktree add`
 *    only mkdirs the leaf and fails if intermediate directories are
 *    absent).
 * 3. Creates worktree at `getWorktreePath(runId, workflowDir)` from `ref`,
 *    detached.
 * Returns the relative worktree path.
 */
export async function createWorktree(
  runId: string,
  workflowDir: string,
  ref = "origin/main",
): Promise<string> {
  // Fetch latest
  await runGit(["fetch", "origin", "main"], "git fetch origin main failed");

  const worktreePath = getWorktreePath(runId, workflowDir);

  // Ensure parent runs/<runId>/ dir exists; git worktree add creates only
  // the leaf and fails when an intermediate dir is missing.
  await Deno.mkdir(`${workflowDir}/runs/${runId}`, { recursive: true });

  // Create worktree (detached HEAD from ref)
  await runGit(
    ["worktree", "add", "--detach", worktreePath, ref],
    `git worktree add failed for ${worktreePath}`,
  );

  return worktreePath;
}

/**
 * Remove a git worktree. Swallows NotFound errors (idempotent).
 * Uses --force to handle dirty worktrees (artifacts may have been written).
 *
 * After the primary remove, runs `git worktree prune` (idempotent,
 * fail-silent) to clean up stale gitlinks under `.git/worktrees/<runId>/`.
 * Without prune, a worktree directory removed out-of-band (manual rm,
 * crashed cleanup) leaves behind a gitlink that blocks any future
 * `git worktree add` at the same path.
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  try {
    await runGit(
      ["worktree", "remove", "--force", worktreePath],
      `git worktree remove failed for ${worktreePath}`,
    );
  } catch (err) {
    // Swallow only the "worktree already gone" case. Anything else (e.g.,
    // a dirty refusal we should never see because of --force) re-throws.
    if (
      !(err instanceof Error &&
        (err.message.includes("is not a working tree") ||
          err.message.includes("No such file or directory")))
    ) {
      throw err;
    }
  }

  // Tail prune. Idempotent; errors swallowed because git binary missing or
  // a transient corruption shouldn't block teardown of the run state.
  try {
    await runGit(["worktree", "prune"], "git worktree prune failed");
  } catch {
    // intentional swallow
  }
}

/**
 * Resolve an existing worktree for a (runId, workflowDir) pair.
 *
 * Probes the FR-E57 path first; falls back to the pre-FR-E57 repo-global
 * layout when only the legacy directory is present. Returns `undefined` if
 * neither path exists. The `legacy` flag lets callers (e.g., `Engine.run()`)
 * surface a one-line warning that the old layout is still in use.
 *
 * The fallback exists only to let an in-flight resume cross the upgrade
 * boundary; new worktrees are always created at the FR-E57 path. Removal
 * scheduled for a follow-up FR.
 */
export function resolveExistingWorktreePath(
  runId: string,
  workflowDir: string,
): { path: string; legacy: boolean } | undefined {
  const fresh = getWorktreePath(runId, workflowDir);
  const legacy = `${LEGACY_WORKTREE_BASE}/${runId}`;
  for (const [p, isLegacy] of [[fresh, false], [legacy, true]] as const) {
    try {
      if (Deno.statSync(p).isDirectory) {
        return { path: p, legacy: isLegacy };
      }
    } catch {
      // not found, try next candidate
    }
  }
  return undefined;
}

/** Check whether a worktree directory exists for the given run ID under
 * `workflowDir`. Honours the legacy-resume fallback — see
 * {@link resolveExistingWorktreePath}. */
export function worktreeExists(runId: string, workflowDir: string): boolean {
  return resolveExistingWorktreePath(runId, workflowDir) !== undefined;
}

/**
 * Copy a file from workDir to the original repo (relative paths).
 * Used to persist state.json to original repo before worktree removal.
 */
export async function copyToOriginalRepo(
  workDir: string,
  relativePath: string,
): Promise<void> {
  const src = `${workDir}/${relativePath}`;
  // Ensure destination directory exists
  const destDir = relativePath.substring(0, relativePath.lastIndexOf("/"));
  if (destDir) {
    await Deno.mkdir(destDir, { recursive: true });
  }
  await Deno.copyFile(src, relativePath);
}

/**
 * Pin a detached HEAD in `workDir` to a fresh rescue branch (FR-E51).
 *
 * Worktrees are created with `--detach` (FR-E24), so commits made during a
 * run are reachable only via the worktree's HEAD. After `removeWorktree`
 * those commits become unreachable and eligible for git gc. This function
 * snapshots HEAD into a named branch BEFORE removal so the work survives.
 *
 * Returns the rescue branch name, or `undefined` when HEAD is already on a
 * named branch (no rescue needed). Branch name is
 * `flowai/run-<runId>-orphan-rescue`; if that name already exists (resume
 * of the same run-id, repeat invocation), a counter suffix `-2`, `-3`, …
 * is appended until a free name is found.
 *
 * Non-destructive: uses `git branch <name> HEAD` (cannot overwrite an
 * existing branch) — failure to find a free name within 1000 attempts
 * surfaces as an error to the caller.
 */
export async function pinDetachedHead(
  workDir: string,
  runId: string,
): Promise<string | undefined> {
  const symRef = await new Deno.Command("git", {
    args: ["-C", workDir, "symbolic-ref", "-q", "HEAD"],
    stdout: "null",
    stderr: "null",
  }).output();
  if (symRef.success) return undefined;

  const baseName = `flowai/run-${runId}-orphan-rescue`;
  let name = baseName;
  for (let counter = 2; await branchExists(workDir, name); counter++) {
    if (counter > 1000) {
      throw new Error(
        `Could not find free rescue branch name after 1000 attempts (base: ${baseName})`,
      );
    }
    name = `${baseName}-${counter}`;
  }

  const create = await new Deno.Command("git", {
    args: ["-C", workDir, "branch", name, "HEAD"],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!create.success) {
    const stderr = new TextDecoder().decode(create.stderr).trim();
    throw new Error(`git branch ${name} failed: ${stderr}`);
  }
  return name;
}

/** Check whether a local branch ref exists in `workDir`. */
async function branchExists(workDir: string, name: string): Promise<boolean> {
  const out = await new Deno.Command("git", {
    args: [
      "-C",
      workDir,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${name}`,
    ],
    stdout: "null",
    stderr: "null",
  }).output();
  return out.success;
}

/** Run a git command, throw with context on failure. */
async function runGit(args: string[], errorContext: string): Promise<string> {
  const cmd = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${errorContext}${stderr ? `: ${stderr}` : ""}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}
