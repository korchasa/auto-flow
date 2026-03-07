// Tests for stage-1-pm.sh — Stage 1 (PM) orchestration script.
// Validates: argument parsing, directory creation, agent invocation,
// artifact validation (4 required sections), safety checks, commit flow.

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

const SCRIPT_PATH = new URL("./stage-1-pm.sh", import.meta.url).pathname;
const LIB_PATH = new URL("./lib.sh", import.meta.url).pathname;

/** Run stage-1-pm.sh (or a bash snippet sourcing it) in a controlled env. */
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

/** Run a bash snippet that sources lib.sh. */
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

Deno.test("stage-1-pm: fails without issue number argument", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-1-pm: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// validate_spec_sections() — checks 01-spec.md has 4 required sections
// ============================================================

Deno.test("validate_spec_sections: passes with all 4 sections", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Spec

## Problem Statement
Something is broken.

## Affected Requirements
FR-1, FR-2.

## SRS Changes
Added FR-17.

## Scope Boundaries
Not included: UI changes.
`,
  );

  // Source stage-1-pm.sh and call validate_spec_sections
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_spec_sections "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_spec_sections: fails when section is missing", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Spec

## Problem Statement
Something is broken.

## Affected Requirements
FR-1.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_spec_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "SRS Changes");
  await Deno.remove(tmp);
});

Deno.test("validate_spec_sections: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_spec_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// validate_no_sds_details() — ensures no SDS-level content
// ============================================================

Deno.test("validate_no_sds_details: passes clean spec", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `## Problem Statement
Users need feature X.

## Affected Requirements
FR-1.

## SRS Changes
Added FR-17.

## Scope Boundaries
No UI changes.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_no_sds_details "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_no_sds_details: detects SDS-level headings", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `## Problem Statement
Something.

## Affected Requirements
FR-1.

## SRS Changes
Added FR-17.

## Scope Boundaries
None.

## Data Structures
Some implementation detail.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_no_sds_details "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "SDS");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt() — constructs the prompt from issue data
// ============================================================

Deno.test("build_task_prompt: includes issue number, title, body", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 "Fix login bug" "Users cannot log in when..."`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "Fix login bug");
  assertStringIncludes(result.stdout, "Users cannot log in when");
});

// ============================================================
// Script is executable and passes shellcheck
// ============================================================

Deno.test("stage-1-pm.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-1-pm.sh: passes shellcheck", async () => {
  const cmd = new Deno.Command("shellcheck", {
    args: ["-s", "bash", SCRIPT_PATH],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stderr = new TextDecoder().decode(output.stderr);
  const stdout = new TextDecoder().decode(output.stdout);
  assertEquals(
    output.code,
    0,
    `shellcheck failed:\n${stdout}\n${stderr}`,
  );
});
