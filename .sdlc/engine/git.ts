/**
 * Git operations for the pipeline engine.
 * - Commit per node
 * - Diff-based safety checks (out-of-scope modifications, secret detection)
 */

/** Result of a git commit operation. */
export interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

/** Result of a safety check. */
export interface SafetyCheckResult {
  safe: boolean;
  violations: string[];
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

    // Check if there are changes to commit
    const status = await runGit(["status", "--porcelain"]);
    if (!status.trim()) {
      return { success: true, commitHash: undefined }; // Nothing to commit
    }

    // Commit with pipeline-specific message
    const message = `sdlc(${nodeId}): ${runId} — ${label}`;
    await runGit(["commit", "-m", message]);

    // Get the commit hash
    const hash = (await runGit(["rev-parse", "HEAD"])).trim();
    return { success: true, commitHash: hash };
  } catch (err) {
    return {
      success: false,
      error: `Git commit failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Check git diff for safety violations:
 * 1. Out-of-scope file modifications
 * 2. Secret-like patterns in diff content
 */
export async function safetyCheckDiff(
  allowedPaths: string[],
): Promise<SafetyCheckResult> {
  const violations: string[] = [];

  // Get changed files
  let changedFiles: string[];
  try {
    const diffOutput = await runGit(["diff", "--name-only", "HEAD"]);
    const stagedOutput = await runGit(["diff", "--name-only", "--cached"]);
    const combined = `${diffOutput}\n${stagedOutput}`.trim();
    changedFiles = combined ? combined.split("\n").filter(Boolean) : [];
  } catch {
    // No HEAD commit yet or no changes
    return { safe: true, violations: [] };
  }

  if (changedFiles.length === 0) {
    return { safe: true, violations: [] };
  }

  // Skip scope check if no allowed paths configured
  if (allowedPaths.length > 0) {
    for (const file of changedFiles) {
      const allowed = allowedPaths.some(
        (pattern) => file === pattern || file.startsWith(pattern),
      );
      if (!allowed) {
        violations.push(`Out-of-scope modification: ${file}`);
      }
    }
  }

  // Check for secret-like patterns in diff content
  try {
    const diffContent = await runGit(["diff", "HEAD"]);
    const secretPattern =
      /(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*['"][^'"]{8,}/i;
    if (secretPattern.test(diffContent)) {
      violations.push("Potential secret detected in diff content");
    }
  } catch {
    // Ignore diff read errors
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/** Get the current branch name. */
export async function getCurrentBranch(): Promise<string> {
  return (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
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
