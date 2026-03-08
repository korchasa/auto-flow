// Tests for stage-6-executor.sh — Stage 6 (Executor loop controller).
// Validates: argument parsing, allowlist extraction, diff validation,
// build_task_prompt, shellcheck.
// See: requirements.md FR-7, FR-8.

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

const SCRIPT_PATH = new URL("./stage-6-executor.sh", import.meta.url).pathname;
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

Deno.test("stage-6-executor: fails without issue number", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-6-executor: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// extract_executor_allowlist()
// ============================================================

Deno.test("extract_executor_allowlist: extracts files from YAML frontmatter", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
variant: "Variant A"
tasks:
  - desc: "Add validation"
    files: ["src/validate.ts", "src/validate_test.ts"]
  - desc: "Update config"
    files: ["src/config.ts"]
---

## Details
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && extract_executor_allowlist "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  const output = result.stdout.trim();
  assertStringIncludes(output, "src/validate.ts");
  assertStringIncludes(output, "src/config.ts");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt()
// ============================================================

Deno.test("build_task_prompt: includes issue number and iteration", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 1 "/tmp/04-decision.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "Iteration 1");
  assertStringIncludes(result.stdout, "04-decision.md");
});

Deno.test("build_task_prompt: includes QA report path on iteration > 1", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "---\nverdict: FAIL\n---\n## Issues\n");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 2 "/tmp/04-decision.md" "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "QA");
  assertStringIncludes(result.stdout, "blocking");
  await Deno.remove(tmp);
});

// ============================================================
// Script quality
// ============================================================

Deno.test("stage-6-executor.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-6-executor.sh: passes shellcheck", async () => {
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
