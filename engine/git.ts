/**
 * Git operations for the pipeline engine.
 * - Commit per node (used by committer agent nodes)
 * - Branch management
 */

/** Result of a git commit operation. */
export interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
  /** Files staged in this commit (from `git diff --cached --name-only`). */
  filesStaged: string[];
  /** Commit message used. */
  message: string;
}

/** Commit all changes with a node-specific message. */
export async function commitNodeChanges(
  nodeId: string,
  runId: string,
  label: string,
): Promise<CommitResult> {
  try {
    // Stage all changes
    await runGit(["add", "-A"]);

    // Capture staged files before commit
    const stagedOutput = await runGit(["diff", "--cached", "--name-only"]);
    const filesStaged = stagedOutput.trim()
      ? stagedOutput.trim().split("\n").filter(Boolean)
      : [];

    // Check if there are changes to commit
    if (filesStaged.length === 0) {
      return {
        success: true,
        commitHash: undefined,
        filesStaged: [],
        message: "",
      };
    }

    // Commit with pipeline-specific message
    const message = `sdlc(${nodeId}): ${runId} — ${label}`;
    await runGit(["commit", "-m", message]);

    // Get the commit hash
    const hash = (await runGit(["rev-parse", "HEAD"])).trim();
    return { success: true, commitHash: hash, filesStaged, message };
  } catch (err) {
    return {
      success: false,
      error: `Git commit failed: ${(err as Error).message}`,
      filesStaged: [],
      message: "",
    };
  }
}

/** Get the current branch name. */
export async function getCurrentBranch(): Promise<string> {
  return (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

/** Get the current branch name (short alias for verbose output). */
export async function branch(): Promise<string> {
  return (await runGit(["branch", "--show-current"])).trim();
}

/** Push current branch to origin with retry. */
export async function pushToOrigin(
  maxRetries: number = 3,
  retryDelaySeconds: number = 5,
): Promise<void> {
  const branch = await getCurrentBranch();
  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await runGit(["push", "origin", branch]);
      return;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < maxRetries) {
        const delay = retryDelaySeconds * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      }
    }
  }

  throw new Error(`Git push failed after ${maxRetries} attempts: ${lastError}`);
}

/**
 * Rollback all uncommitted changes (staged + unstaged modifications).
 * Does NOT run `git clean` — preserves untracked files.
 * Used by engine pre-step before `run_always` nodes on pipeline failure.
 */
export async function rollbackUncommitted(): Promise<void> {
  await runGit(["reset", "HEAD"]);
  await runGit(["checkout", "--", "."]);
}

// --- Internal helpers ---

/** Run a git command and return stdout. */
async function runGit(args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`git ${args[0]} failed: ${stderr}`);
  }

  return new TextDecoder().decode(output.stdout);
}
