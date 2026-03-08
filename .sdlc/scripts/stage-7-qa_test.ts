// Tests for stage-7-qa.sh — Stage 7 (QA).
// Validates: argument parsing, verdict extraction, report validation, shellcheck.
// See: requirements.md FR-7.

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

const SCRIPT_PATH = new URL("./stage-7-qa.sh", import.meta.url).pathname;
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

Deno.test("stage-7-qa: fails without arguments", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-7-qa: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc", "1"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

Deno.test("stage-7-qa: fails with non-numeric iteration", async () => {
  const result = await runScript(["42", "abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// extract_verdict()
// ============================================================

Deno.test("extract_verdict: extracts PASS from valid report", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "---\nverdict: PASS\n---\n\n## Details\n");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && extract_verdict "${tmp}"`,
  );
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout.trim(), "PASS");
  await Deno.remove(tmp);
});

Deno.test("extract_verdict: extracts FAIL from valid report", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "---\nverdict: FAIL\n---\n\n## Details\n");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && extract_verdict "${tmp}"`,
  );
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout.trim(), "FAIL");
  await Deno.remove(tmp);
});

Deno.test("extract_verdict: fails on invalid verdict", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "---\nverdict: MAYBE\n---\n");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && extract_verdict "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

Deno.test("extract_verdict: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && extract_verdict "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// validate_qa_report()
// ============================================================

Deno.test("validate_qa_report: passes with valid report", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    "---\nverdict: PASS\n---\n\n## Check Results\nAll passed.\n",
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_qa_report "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_qa_report: fails without frontmatter", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "# QA Report\nverdict: PASS\n");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_qa_report "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "frontmatter");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt()
// ============================================================

Deno.test("build_task_prompt: includes issue number and iteration", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 1 "/tmp/01-spec.md" "/tmp/04-decision.md" "/tmp/05-qa-report-1.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "Iteration 1");
});

// ============================================================
// Script quality
// ============================================================

Deno.test("stage-7-qa.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-7-qa.sh: passes shellcheck", async () => {
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
