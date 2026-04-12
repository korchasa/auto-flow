/**
 * @module
 * Interactive REPL entry point for flowai-workflow. Launches an AI-assisted
 * session with bundled management skills (init, adapt-agents). The REPL asks
 * which runtime to use on first launch and persists the choice.
 *
 * Dispatched from `engine/cli.ts` when the user runs `flowai-workflow`
 * without arguments.
 */

import { parseSkill } from "@korchasa/ai-ide-cli/skill";
import { getRuntimeAdapter } from "@korchasa/ai-ide-cli/runtime";
import type { SkillDef } from "@korchasa/ai-ide-cli/skill";
import type { RuntimeId } from "@korchasa/ai-ide-cli/types";
import { VALID_RUNTIME_IDS } from "@korchasa/ai-ide-cli/types";
import { dirname, fromFileUrl, join } from "@std/path";

/** Options passed from the CLI dispatcher. */
export interface LaunchReplOptions {
  /** Engine version string for display. */
  engineVersion?: string;
  /** Override runtime selection (skip prompt). */
  runtime?: RuntimeId;
}

/** Persisted runtime config file path. */
const CONFIG_DIR_NAME = "flowai-workflow";
const CONFIG_FILE_NAME = "runtime.json";

/**
 * Resolve the runtime to use: CLI flag → persisted config → interactive prompt.
 * Persists the choice after first selection.
 */
export async function resolveRuntime(
  override?: RuntimeId,
): Promise<RuntimeId> {
  if (override) return override;

  // Check persisted config
  const configPath = getRuntimeConfigPath();
  try {
    const raw = await Deno.readTextFile(configPath);
    const config = JSON.parse(raw) as { runtime?: string };
    if (
      config.runtime &&
      (VALID_RUNTIME_IDS as readonly string[]).includes(config.runtime)
    ) {
      return config.runtime as RuntimeId;
    }
  } catch {
    // No persisted config — prompt user
  }

  // Interactive prompt
  const runtime = await promptRuntime();
  await persistRuntime(runtime, configPath);
  return runtime;
}

/** Prompt the user to select a runtime from the terminal. */
async function promptRuntime(): Promise<RuntimeId> {
  const interactive = VALID_RUNTIME_IDS.filter((id) => {
    const adapter = getRuntimeAdapter(id);
    return adapter.capabilities.interactive;
  });

  console.log("Select AI runtime for interactive mode:\n");
  for (let i = 0; i < interactive.length; i++) {
    console.log(`  ${i + 1}. ${interactive[i]}`);
  }
  console.log();

  const buf = new Uint8Array(64);
  while (true) {
    await Deno.stdout.write(
      new TextEncoder().encode(`Choice [1-${interactive.length}]: `),
    );
    const n = await Deno.stdin.read(buf);
    if (n === null) {
      // EOF — default to first option
      return interactive[0];
    }
    const input = new TextDecoder().decode(buf.subarray(0, n)).trim();
    const idx = parseInt(input, 10) - 1;
    if (idx >= 0 && idx < interactive.length) {
      return interactive[idx];
    }
    console.log(`Invalid choice. Enter a number 1-${interactive.length}.`);
  }
}

/** Persist runtime choice to config file. */
async function persistRuntime(
  runtime: RuntimeId,
  configPath: string,
): Promise<void> {
  try {
    const dir = dirname(configPath);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      configPath,
      JSON.stringify({ runtime }, null, 2) + "\n",
    );
  } catch {
    // Non-fatal: user can re-select next time
  }
}

/** Return the path to the persisted runtime config file. */
function getRuntimeConfigPath(): string {
  const home = Deno.env.get("HOME") ??
    Deno.env.get("USERPROFILE") ?? Deno.cwd();
  return join(home, ".config", CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * Load all bundled REPL skills from `engine/repl/skills/`. Each subdirectory
 * with a SKILL.md is parsed via `parseSkill()`.
 */
export async function loadBundledSkills(): Promise<SkillDef[]> {
  const skillsRoot = resolveSkillsRoot();
  const skills: SkillDef[] = [];

  try {
    for await (const entry of Deno.readDir(skillsRoot)) {
      if (!entry.isDirectory) continue;
      try {
        const skill = await parseSkill(join(skillsRoot, entry.name));
        skills.push(skill);
      } catch (err) {
        console.error(
          `Warning: failed to load bundled skill "${entry.name}": ${
            (err as Error).message
          }`,
        );
      }
    }
  } catch {
    // skills dir may not exist in some dev setups
  }

  return skills;
}

/**
 * Resolve the absolute path to the bundled skills directory. Uses
 * `import.meta.url` so it works in local dev, JSR, and compiled binary.
 */
function resolveSkillsRoot(): string {
  return join(dirname(fromFileUrl(import.meta.url)), "skills");
}

/** System prompt injected into every REPL session. */
function buildSystemPrompt(engineVersion: string): string {
  return [
    `You are the flowai-workflow management assistant (engine v${engineVersion}).`,
    "You have access to bundled skills for project management:",
    "- /init — initialize a new flowai-workflow project",
    "- /adapt-agents — adapt agents after a framework update",
    "",
    "Help the user manage their flowai-workflow projects.",
    "Use the available skills when the user asks for setup, initialization, or agent adaptation.",
  ].join("\n");
}

/**
 * Launch the interactive REPL. Returns an exit code.
 *
 * Steps:
 * 1. Resolve runtime (prompt if needed)
 * 2. Check runtime supports interactive mode
 * 3. Load bundled skills
 * 4. Launch interactive session via adapter
 */
export async function launchRepl(
  opts: LaunchReplOptions = {},
): Promise<number> {
  const version = opts.engineVersion ?? "dev";
  console.log(`flowai-workflow v${version} — interactive mode\n`);

  const runtime = await resolveRuntime(opts.runtime);
  const adapter = getRuntimeAdapter(runtime);

  if (!adapter.capabilities.interactive) {
    console.error(
      `Runtime "${runtime}" does not support interactive mode.` +
        ` Supported runtimes: ${
          VALID_RUNTIME_IDS.filter((id) =>
            getRuntimeAdapter(id).capabilities.interactive
          ).join(", ")
        }`,
    );
    return 1;
  }

  const skills = await loadBundledSkills();
  const systemPrompt = buildSystemPrompt(version);

  try {
    const result = await adapter.launchInteractive({
      skills,
      systemPrompt,
      cwd: Deno.cwd(),
    });
    return result.exitCode;
  } catch (err) {
    console.error(`REPL error: ${(err as Error).message}`);
    return 1;
  }
}
