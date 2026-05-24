// Local install / refresh of the bundled Claude Code plugin.
//
// `deno task sync-claude-plugin` re-points the `flowai-workflow-local`
// marketplace at ./claude-plugin and installs (or updates) the
// `flowai-workflow` plugin at user scope.
//
// Missing `claude` CLI is reported and skipped, not fatal.

import { isAbsolute, join, resolve } from "@std/path";

const PLUGIN_DIR = "claude-plugin";
const MARKETPLACE_NAME = "flowai-workflow-local";
const PLUGIN_NAME = "flowai-workflow";

type CommandOutput = {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

type ClaudePluginListEntry = {
  id?: unknown;
  scope?: unknown;
  enabled?: unknown;
};

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function runCaptured(
  cmd: string,
  args: string[],
): Promise<CommandOutput> {
  const output = await new Deno.Command(cmd, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    code: output.code,
    stdout: decode(output.stdout),
    stderr: decode(output.stderr),
  };
}

async function runInherited(cmd: string, args: string[]): Promise<void> {
  const status = await new Deno.Command(cmd, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  if (!status.success) {
    throw new Error(
      `Command failed (${status.code ?? 1}): ${cmd} ${args.join(" ")}`,
    );
  }
}

async function runInheritedAllowFail(
  cmd: string,
  args: string[],
): Promise<boolean> {
  const status = await new Deno.Command(cmd, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status.success;
}

async function commandAvailable(cmd: string): Promise<boolean> {
  try {
    const output = await new Deno.Command(cmd, {
      args: ["--version"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output();
    return output.success;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function readClaudePluginList(): Promise<ClaudePluginListEntry[]> {
  const result = await runCaptured("claude", ["plugin", "list", "--json"]);
  if (!result.success) {
    throw new Error(
      `Failed to list Claude Code plugins (${result.code}): ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Claude Code plugin list returned non-array JSON.");
  }
  return parsed as ClaudePluginListEntry[];
}

type PluginAction = "install" | "update" | "skip";

export function decidePluginAction(
  installed: ClaudePluginListEntry[],
  pluginId: string,
): PluginAction {
  for (const entry of installed) {
    if (typeof entry.id !== "string" || entry.scope !== "user") continue;
    if (entry.id !== pluginId) continue;
    return entry.enabled === true ? "update" : "skip";
  }
  return "install";
}

async function syncClaude(absolutePluginDir: string): Promise<void> {
  if (!(await commandAvailable("claude"))) {
    console.log(
      "[sync-claude-plugin] `claude` CLI not found in PATH; skipping install.",
    );
    return;
  }
  const marketplaceJson = join(
    absolutePluginDir,
    ".claude-plugin",
    "marketplace.json",
  );
  const stat = await Deno.stat(marketplaceJson).catch(() => null);
  if (!stat || !stat.isFile) {
    throw new Error(
      `Marketplace manifest not found: ${marketplaceJson}. Expected layout: ` +
        `${PLUGIN_DIR}/.claude-plugin/marketplace.json`,
    );
  }

  // Capture installed state BEFORE removing the marketplace — marketplace
  // remove drops entries from `claude plugin list`, which would mis-route
  // the plugin to `install` and erase the user's enabled state.
  const installedBefore = await readClaudePluginList();
  const pluginId = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  const action = decidePluginAction(installedBefore, pluginId);

  console.log(
    `[sync-claude-plugin] Re-pointing marketplace ${MARKETPLACE_NAME} at ${absolutePluginDir}`,
  );
  await runInheritedAllowFail("claude", [
    "plugin",
    "marketplace",
    "remove",
    MARKETPLACE_NAME,
  ]);
  await runInherited("claude", [
    "plugin",
    "marketplace",
    "add",
    absolutePluginDir,
  ]);

  if (action === "install") {
    console.log(`[sync-claude-plugin] Installing ${pluginId}`);
    await runInherited("claude", [
      "plugin",
      "install",
      pluginId,
      "--scope",
      "user",
    ]);
  } else if (action === "update") {
    console.log(`[sync-claude-plugin] Updating ${pluginId}`);
    await runInherited("claude", [
      "plugin",
      "update",
      pluginId,
      "--scope",
      "user",
    ]);
  } else {
    console.log(
      `[sync-claude-plugin] Skipping ${pluginId} (installed but disabled — preserving user choice).`,
    );
  }
}

export function parseArgs(argv: string[]): { pluginDir: string } {
  let pluginDir = PLUGIN_DIR;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(
          `--dir requires a directory argument (got ${
            value === undefined ? "end-of-args" : `"${value}"`
          }).`,
        );
      }
      pluginDir = value;
      i++;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: sync-claude-plugin.ts [--dir <plugin-dir>]\n" +
          `  --dir <dir>   Plugin marketplace root (default: ./${PLUGIN_DIR})`,
      );
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { pluginDir };
}

async function main(): Promise<void> {
  const { pluginDir } = parseArgs(Deno.args);
  const absolute = isAbsolute(pluginDir) ? pluginDir : resolve(pluginDir);
  await syncClaude(absolute);
  console.log("[sync-claude-plugin] Done.");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
