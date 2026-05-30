/**
 * @module
 * `deno task sync-plugins-local` — framework-developer dogfood loop (FR-E72).
 *
 * Rebuilds the plugin payload at `./dist/plugin-payload`, re-points the
 * `flowai-workflow` marketplace in Claude Code AND Codex at that local
 * path, and installs / refreshes every emitted plugin at user scope.
 *
 * Mirrors the contract of `flowai/flowai/scripts/sync-plugins-local.ts`
 * so developers cross-cutting between the two repos see identical UX.
 *
 * Behaviour:
 * - Captures `claude plugin list --json` BEFORE marketplace removal so
 *   previously-`enabled=false` plugins stay disabled on reinstall.
 * - Runs `codex plugin add <name>@flowai-workflow-local` for every
 *   emitted plugin so Codex materializes the payload cache, then
 *   reconciles `~/.codex/config.toml` `[plugins."<x>@<marketplace>"]`
 *   tables while preserving prior `enabled` per plugin.
 * - Missing `claude` / `codex` CLIs (or older Codex without `plugin
 *   marketplace`) are reported and skipped, not fatal.
 * - `AUTO_INSTALL_PLUGINS=true` (env var OR `.env`) opts the dev hook
 *   in via {@link runIfAutoInstallEnabled}; any other value is a no-op.
 */

import { fromFileUrl, isAbsolute, join, resolve } from "@std/path";
import { buildPluginPayload } from "./build-plugin-payload.ts";

const DEFAULT_OUT_DIR = "dist/plugin-payload";
/**
 * Local marketplace name. Intentionally distinct from the published name
 * (`flowai-workflow`) so `claude plugin list` clearly separates the
 * dev-loop install (`<plugin>@flowai-workflow-local`) from the official
 * release install (`<plugin>@flowai-workflow`). Passed into
 * {@link buildPluginPayload} via its `marketplaceName` option so the
 * generated `marketplace.json#name` carries this value directly — no
 * post-build patching.
 */
const MARKETPLACE_NAME = "flowai-workflow-local";

/** Env var (and dotenv key) that gates the auto-install dev hook. */
export const ENV_AUTO_INSTALL_PLUGINS = "AUTO_INSTALL_PLUGINS";

export function localPayloadRoots(
  outDir: string,
): { claude: string; codex: string } {
  return {
    claude: join(outDir, "claude"),
    codex: join(outDir, "codex"),
  };
}

function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Pure check used by tests: returns true iff the dotenv content sets
 * `AUTO_INSTALL_PLUGINS=true` (exact match — any other value such as
 * `1` / `yes` / `True` is treated as disabled to avoid surprises).
 */
export function autoInstallEnabled(dotenvContent: string): boolean {
  return parseDotenv(dotenvContent)[ENV_AUTO_INSTALL_PLUGINS] === "true";
}

/**
 * Process-level check: process env wins; otherwise falls back to reading
 * the given dotenv file (default `.env`). Missing dotenv → disabled.
 */
export async function shouldAutoInstall(
  dotenvPath = ".env",
): Promise<boolean> {
  if (Deno.env.get(ENV_AUTO_INSTALL_PLUGINS) === "true") return true;
  try {
    return autoInstallEnabled(await Deno.readTextFile(dotenvPath));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Line-based parse of a Codex `config.toml`: identifies every
 * `[plugins."<x>@<marketplace>"]` table, removes the header and ALL body
 * lines up to the next `[section]` header (or EOF), and reports the
 * previous `enabled` value for each table. Tolerates CRLF, trailing
 * whitespace, inline `# comments` on `enabled = …`, and tables with
 * extra keys.
 *
 * Returned `stripped` text preserves all unrelated content. Runs of three
 * or more blank lines created by stripping are collapsed to one.
 */
export function parseAndStripFlowaiTables(
  configText: string,
  marketplaceName: string = MARKETPLACE_NAME,
): { stripped: string; previousEnabled: Map<string, boolean> } {
  const tableHeader = new RegExp(
    `^\\s*\\[plugins\\."([^"]*)@${
      escapeRegex(marketplaceName)
    }"\\]\\s*(?:#.*)?$`,
  );
  const sectionHeader = /^\s*\[/;
  const enabledLine = /^\s*enabled\s*=\s*(true|false)\b/;

  const normalized = configText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  const previousEnabled = new Map<string, boolean>();
  const kept: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const header = lines[i].match(tableHeader);
    if (!header) {
      kept.push(lines[i]);
      i++;
      continue;
    }
    const name = header[1];
    let enabled = true;
    i++;
    while (i < lines.length && !sectionHeader.test(lines[i])) {
      const em = lines[i].match(enabledLine);
      if (em) enabled = em[1] === "true";
      i++;
    }
    previousEnabled.set(name, enabled);
  }

  const collapsed: string[] = [];
  let blankRun = 0;
  for (const line of kept) {
    if (line.trim() === "") {
      blankRun++;
      if (blankRun <= 1) collapsed.push(line);
    } else {
      blankRun = 0;
      collapsed.push(line);
    }
  }

  return {
    stripped: collapsed.join("\n"),
    previousEnabled,
  };
}

/**
 * Reconcile flowai-workflow entries in a Codex `config.toml`:
 *   1. Strip every existing `[plugins."<x>@<marketplace>"]` table.
 *   2. Append one fresh 2-line table per emitted plugin, preserving the
 *      previous `enabled` value when present (default `true` for new).
 *
 * Throws when `emittedNames` is empty — that signals a broken upstream
 * build and silently wiping the user's plugin set would lose data.
 */
export function reconcileCodexFlowaiPluginEntries(
  configText: string,
  emittedNames: string[],
  marketplaceName: string = MARKETPLACE_NAME,
  preservedEnabled: Map<string, boolean> = new Map(),
): string {
  if (emittedNames.length === 0) {
    throw new Error(
      "reconcileCodexFlowaiPluginEntries: refusing to reconcile with an empty " +
        "emittedNames set (upstream marketplace.json yielded no plugins).",
    );
  }
  const { stripped, previousEnabled } = parseAndStripFlowaiTables(
    configText,
    marketplaceName,
  );
  const trimmed = stripped.replace(/\n+$/, "");
  const blocks = emittedNames
    .map((name) => {
      const enabled = preservedEnabled.get(name) ?? previousEnabled.get(name) ??
        true;
      return `[plugins."${name}@${marketplaceName}"]\nenabled = ${enabled}\n`;
    })
    .join("\n");
  return `${trimmed}\n\n${blocks}`;
}

function codexPluginEnabled(
  configText: string,
  pluginName: string,
  marketplaceName: string,
): boolean {
  const { previousEnabled } = parseAndStripFlowaiTables(
    configText,
    marketplaceName,
  );
  return previousEnabled.get(pluginName) ?? false;
}

export function detectCodexPluginMcpNameCollisions(
  configText: string,
  emittedNames: string[],
  localMarketplaceName: string = MARKETPLACE_NAME,
  officialMarketplaceName = "flowai-workflow",
): string[] {
  return emittedNames.filter((name) =>
    codexPluginEnabled(configText, name, localMarketplaceName) &&
    codexPluginEnabled(configText, name, officialMarketplaceName)
  );
}

export function planCodexPluginAdds(
  emittedNames: string[],
  marketplaceName: string = MARKETPLACE_NAME,
): string[] {
  return emittedNames.map((name) => `${name}@${marketplaceName}`);
}

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

/** Bucketed plan for Claude Code reinstall after a marketplace re-add. */
export type ClaudeActionPlan = {
  /**
   * Plugins to (re)install at user scope. After `marketplace remove`,
   * `claude plugin update` reports the plugin as "not installed" — we
   * therefore route every plugin the user had enabled (plus brand-new
   * ones) through `claude plugin install`, which is idempotent.
   */
  install: string[];
  /**
   * Plugins the user previously installed at user scope but explicitly
   * disabled (`enabled = false`). We do NOT re-enable them — leave the
   * mute choice intact by not installing.
   */
  skipped: string[];
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

/**
 * Codex 0.130+ exposes `codex plugin marketplace`; older builds do not.
 * Probe the help text so we warn + skip on older Codex without aborting.
 */
async function codexMarketplaceSubcommandAvailable(): Promise<boolean> {
  const result = await runCaptured("codex", [
    "plugin",
    "marketplace",
    "--help",
  ]);
  return result.success;
}

/**
 * Reads the emitted `marketplace.json` and returns the plugin names that
 * the local build advertises (sorted, deduplicated).
 */
export function readMarketplacePluginNames(marketplaceJson: string): string[] {
  const parsed = JSON.parse(marketplaceJson) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { plugins?: unknown }).plugins)
  ) {
    throw new Error(
      "Local marketplace.json is missing a top-level `plugins` array.",
    );
  }
  const plugins = (parsed as { plugins: unknown[] }).plugins;
  const names: string[] = [];
  for (const entry of plugins) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string"
    ) {
      names.push((entry as { name: string }).name);
    }
  }
  if (names.length === 0) {
    throw new Error(
      "Local marketplace.json declares zero plugins; refusing to proceed " +
        "(the build emitted nothing — refusing to mutate IDE state).",
    );
  }
  return [...new Set(names)].sort();
}

/**
 * Plans `claude plugin install` calls for a fresh marketplace
 * registration.
 *
 * Why install-only, no update bucket: `claude plugin marketplace remove`
 * detaches every plugin from that marketplace, so a subsequent
 * `claude plugin update <id>` reports "Plugin not installed" and aborts.
 * After re-adding the marketplace we therefore call `plugin install` for
 * every plugin the user wants — which is idempotent. The only exception
 * is plugins the user previously DISABLED at user scope: we leave them
 * alone to preserve the mute choice.
 *
 * `installedBeforeRemove` MUST be captured BEFORE `marketplace remove` —
 * after the remove, the listing has no flowai entries and the disabled
 * set would be lost.
 */
export function planClaudeActions(
  emittedNames: string[],
  installedBeforeRemove: ClaudePluginListEntry[],
  marketplace: string = MARKETPLACE_NAME,
): ClaudeActionPlan {
  const disabledIds = new Set<string>();
  for (const entry of installedBeforeRemove) {
    if (typeof entry.id !== "string" || entry.scope !== "user") continue;
    if (entry.enabled === false) disabledIds.add(entry.id);
  }
  const install: string[] = [];
  const skipped: string[] = [];
  for (const name of emittedNames) {
    const id = `${name}@${marketplace}`;
    if (disabledIds.has(id)) skipped.push(id);
    else install.push(id);
  }
  return { install, skipped };
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

/**
 * Resolve the engine repo root from this script's own location so the
 * tool works from any CWD (not just the repo root).
 */
function engineRoot(): string {
  return fromFileUrl(new URL("..", import.meta.url));
}

function readEngineVersion(root: string): string {
  const denoJson = JSON.parse(
    Deno.readTextFileSync(join(root, "deno.json")),
  ) as { version?: string };
  if (!denoJson.version || typeof denoJson.version !== "string") {
    throw new Error(`deno.json at ${root} is missing a string version field.`);
  }
  return denoJson.version;
}

async function ensureBuild(outDir: string, skipBuild: boolean): Promise<void> {
  if (skipBuild) {
    const roots = localPayloadRoots(outDir);
    const marketplacePaths = [
      join(roots.claude, ".claude-plugin", "marketplace.json"),
      join(roots.codex, ".agents", "plugins", "marketplace.json"),
    ];
    for (const marketplacePath of marketplacePaths) {
      try {
        await Deno.stat(marketplacePath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new Error(
            `--no-build was set but ${marketplacePath} does not exist. ` +
              `Run \`deno run -A scripts/build-plugin-payload.ts --out-dir ${outDir} ` +
              `--version <ver>\` first.`,
          );
        }
        throw error;
      }
    }
    return;
  }
  const root = engineRoot();
  const version = readEngineVersion(root);
  console.log(
    `[sync-plugins-local] Building plugin payload v${version} at ${outDir}`,
  );
  await buildPluginPayload({
    engineRoot: root,
    version,
    outDir: isAbsolute(outDir) ? outDir : resolve(outDir),
    marketplaceName: MARKETPLACE_NAME,
  });
}

async function syncClaude(absoluteOutDir: string): Promise<void> {
  if (!(await commandAvailable("claude"))) {
    console.log(
      "[sync-plugins-local] `claude` CLI not found in PATH; skipping Claude Code sync.",
    );
    return;
  }
  // Capture installed state BEFORE removing the marketplace — marketplace
  // remove drops entries from `claude plugin list`, which would mis-route
  // every plugin to `install` and erase the user's per-plugin enabled state.
  const installedBefore = await readClaudePluginList();

  console.log(
    `[sync-plugins-local] Re-pointing Claude marketplace ${MARKETPLACE_NAME} at ${absoluteOutDir}`,
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
    absoluteOutDir,
  ]);

  const marketplaceJson = await Deno.readTextFile(
    join(absoluteOutDir, ".claude-plugin", "marketplace.json"),
  );
  const emitted = readMarketplacePluginNames(marketplaceJson);
  const plan = planClaudeActions(emitted, installedBefore);

  for (const id of plan.install) {
    console.log(`[sync-plugins-local] Installing Claude Code ${id}`);
    await runInherited("claude", [
      "plugin",
      "install",
      id,
      "--scope",
      "user",
    ]);
  }
  for (const id of plan.skipped) {
    console.log(
      `[sync-plugins-local] Skipping disabled Claude Code plugin ${id} (preserved as enabled=false)`,
    );
  }
}

async function rewriteCodexPluginEntries(
  emittedNames: string[],
  preservedEnabled: Map<string, boolean> = new Map(),
): Promise<void> {
  if (emittedNames.length === 0) {
    throw new Error(
      "rewriteCodexPluginEntries: no plugins emitted by local marketplace; " +
        "refusing to mutate config.toml.",
    );
  }
  const home = Deno.env.get("CODEX_HOME") ?? `${Deno.env.get("HOME")}/.codex`;
  const configPath = `${home}/config.toml`;
  let original: string;
  try {
    original = await Deno.readTextFile(configPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.log(
        `[sync-plugins-local] ${configPath} does not exist; nothing to reconcile.`,
      );
      return;
    }
    throw error;
  }
  const next = reconcileCodexFlowaiPluginEntries(
    original,
    emittedNames,
    MARKETPLACE_NAME,
    preservedEnabled,
  );
  if (next === original) return;
  await Deno.writeTextFile(configPath, next);
  console.log(
    `[sync-plugins-local] Reconciled ${emittedNames.length} flowai plugin entries in ${configPath}`,
  );
}

async function syncCodex(absoluteOutDir: string): Promise<void> {
  if (!(await commandAvailable("codex"))) {
    console.log(
      "[sync-plugins-local] `codex` CLI not found in PATH; skipping Codex sync.",
    );
    return;
  }
  if (!(await codexMarketplaceSubcommandAvailable())) {
    console.log(
      "[sync-plugins-local] Installed Codex CLI lacks `plugin marketplace` subcommand; " +
        "skipping Codex sync (upgrade Codex CLI to >=0.130 to enable).",
    );
    return;
  }
  console.log(
    `[sync-plugins-local] Re-pointing Codex marketplace ${MARKETPLACE_NAME} at ${absoluteOutDir}`,
  );
  const codexHome = Deno.env.get("CODEX_HOME") ??
    `${Deno.env.get("HOME")}/.codex`;
  const configText = await Deno.readTextFile(join(codexHome, "config.toml"))
    .catch((error) => {
      if (error instanceof Deno.errors.NotFound) return "";
      throw error;
    });
  const preservedEnabled = parseAndStripFlowaiTables(configText)
    .previousEnabled;
  await runInheritedAllowFail("codex", [
    "plugin",
    "marketplace",
    "remove",
    MARKETPLACE_NAME,
  ]);
  await runInherited("codex", [
    "plugin",
    "marketplace",
    "add",
    absoluteOutDir,
  ]);

  const marketplaceJson = await Deno.readTextFile(
    join(absoluteOutDir, ".agents", "plugins", "marketplace.json"),
  );
  const emitted = readMarketplacePluginNames(marketplaceJson);
  const collisions = detectCodexPluginMcpNameCollisions(configText, emitted);
  for (const name of collisions) {
    console.log(
      `[sync-plugins-local] Warning: Codex has both official and local ${name} plugins enabled; disable one install before MCP smoke testing to avoid duplicate flowai-workflow MCP startup.`,
    );
  }
  for (const id of planCodexPluginAdds(emitted)) {
    console.log(`[sync-plugins-local] Installing Codex ${id}`);
    await runInherited("codex", ["plugin", "add", id]);
  }
  await rewriteCodexPluginEntries(emitted, preservedEnabled);
}

/**
 * Fail-fast arg parser: a flag that requires a value must be followed by
 * a non-flag token. Missing values surface as errors instead of being
 * silently swallowed into a default.
 */
export function parseArgs(
  argv: string[],
): { outDir: string; skipBuild: boolean } {
  let outDir = DEFAULT_OUT_DIR;
  let skipBuild = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(
          `--out requires a directory argument (got ${
            value === undefined ? "end-of-args" : `"${value}"`
          }).`,
        );
      }
      outDir = value;
      i++;
    } else if (arg === "--no-build") {
      skipBuild = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: sync-plugins-local.ts [--out <dir>] [--no-build]\n" +
          `  --out <dir>   Output dir for the local marketplace (default: ./${DEFAULT_OUT_DIR})\n` +
          "  --no-build    Skip the build step (use an existing dist).",
      );
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { outDir, skipBuild };
}

async function main(): Promise<void> {
  const { outDir, skipBuild } = parseArgs(Deno.args);
  await ensureBuild(outDir, skipBuild);
  const absoluteOutDir = isAbsolute(outDir) ? outDir : resolve(outDir);
  const roots = localPayloadRoots(absoluteOutDir);
  await syncClaude(roots.claude);
  await syncCodex(roots.codex);
  console.log("[sync-plugins-local] Done.");
}

/**
 * Dev-hook entry point: runs {@link main} iff `AUTO_INSTALL_PLUGINS=true`
 * is present in the process env or `.env`. Absence of the flag is a
 * no-op; non-`true` values (e.g. `1`, `yes`, `True`) are NOT accepted.
 *
 * Wired into `scripts/check.ts` so a developer who sets the flag once
 * gets a rebuild + reinstall after every `deno task check`.
 */
export async function runIfAutoInstallEnabled(): Promise<void> {
  if (await shouldAutoInstall()) await main();
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
