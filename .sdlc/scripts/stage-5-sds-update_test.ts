// Tests for stage-5-sds-update.sh — Stage 5 (Tech Lead SDS Update).
// Validates: argument parsing, SDS validation, diff generation, shellcheck.
// See: requirements.md FR-6.

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(
      msg ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertStringIncludes(
  actual: string,
  expected: string,
  msg?: string,
): void {
  if (!actual.includes(expected)) {
    throw new Error(
      msg || `Expected "${actual}" to include "${expected}"`,
    );
  }
}

const SCRIPT_PATH = new URL("./stage-5-sds-update.sh", import.meta.url)
  .pathname;
const LIB_PATH = new URL("./lib.sh", import.meta.url).pathname;

async function runScript(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT_PATH, ...args],
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

async function runLib(
  code: string,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cmd = new Deno.Command("bash", {
    args: ["-c", `source "${LIB_PATH}" && ${code}`],
    env: { ...Deno.env.toObject(), ...env },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    code: output.code,
  };
}

// ============================================================
// Argument validation
// ============================================================

Deno.test("stage-5-sds-update: fails without issue number", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-5-sds-update: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// validate_sds_components()
// ============================================================

Deno.test("validate_sds_components: passes with components section", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# SDS\n\n## 3. Components\n\n### 3.1 Handler\n- **Purpose:** Process requests.\n- **Interfaces:** HTTP API.\n- **Deps:** config module.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_sds_components "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_sds_components: fails without components section", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# SDS\n\n## 1. Intro\nSome intro.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_sds_components "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "component");
  await Deno.remove(tmp);
});

Deno.test("validate_sds_components: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_sds_components "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// generate_sds_diff()
// ============================================================

Deno.test("generate_sds_diff: produces diff file with header", async () => {
  const output = await Deno.makeTempFile({ suffix: ".md" });
  // Run inside repo root where git diff works
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && generate_sds_diff "${output}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  const content = await Deno.readTextFile(output);
  assertStringIncludes(content, "SDS Diff");
  assertStringIncludes(content, "```diff");
  await Deno.remove(output);
});

// ============================================================
// build_task_prompt()
// ============================================================

Deno.test("build_task_prompt: includes issue number and paths", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 "/tmp/04-decision.md" "/tmp/03-revised-plan.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "04-decision.md");
});

// ============================================================
// Script quality
// ============================================================

Deno.test("stage-5-sds-update.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-5-sds-update.sh: passes shellcheck", async () => {
  const cmd = new Deno.Command("shellcheck", {
    args: ["-s", "bash", SCRIPT_PATH],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stderr = new TextDecoder().decode(output.stderr);
  const stdout = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0, `shellcheck failed:\n${stdout}\n${stderr}`);
});
