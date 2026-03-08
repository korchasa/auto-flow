// Tests for stage-2-tech-lead.sh — Stage 2 (Tech Lead) orchestration script.
// Validates: argument parsing, directory creation, agent invocation,
// artifact validation (2-3 variants, concrete file refs, effort, risk),
// safety checks, commit flow.
// See: requirements.md FR-3, FR-8, FR-10, FR-14.

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

const SCRIPT_PATH = new URL("./stage-2-tech-lead.sh", import.meta.url).pathname;
const LIB_PATH = new URL("./lib.sh", import.meta.url).pathname;

/** Run stage-2-tech-lead.sh in a controlled env. */
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

Deno.test("stage-2-tech-lead: fails without issue number argument", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-2-tech-lead: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// validate_plan_variants() — checks 02-plan.md has 2-3 variants
// ============================================================

Deno.test("validate_plan_variants: passes with 2 variants", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Implementation Plan

## Variant A: Direct approach

Modify existing handler.

- **Affected files:** \`src/handler.ts\`, \`src/handler_test.ts\`
- **Effort:** S
- **Risks:** Tight coupling.

## Variant B: New module

Create a new module.

- **Affected files:** \`src/new-module.ts\`, \`src/new-module_test.ts\`
- **Effort:** M
- **Risks:** More code to maintain.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_variants "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_plan_variants: passes with 3 variants", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: Option one

Details.

## Variant B: Option two

Details.

## Variant C: Option three

Details.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_variants "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_plan_variants: fails with 1 variant", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: Only option

Details.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_variants "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "variant");
  await Deno.remove(tmp);
});

Deno.test("validate_plan_variants: fails with 4 variants", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: One

Details.

## Variant B: Two

Details.

## Variant C: Three

Details.

## Variant D: Four

Details.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_variants "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "variant");
  await Deno.remove(tmp);
});

Deno.test("validate_plan_variants: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_variants "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// validate_plan_quality() — checks each variant has file refs, effort, risk
// ============================================================

Deno.test("validate_plan_quality: passes with complete variants", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: Direct approach

Modify the handler directly.

- **Affected files:** \`src/handler.ts\`, \`src/handler_test.ts\`
- **Effort:** S
- **Risks:** Tight coupling to existing code.

## Variant B: New module

Extract into a new module.

- **Affected files:** \`src/module.ts\`
- **Effort:** M
- **Risks:** More maintenance overhead.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_quality "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_plan_quality: fails without file references", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: Direct approach

Modify the handler directly.

- **Effort:** S
- **Risks:** Tight coupling.

## Variant B: New module

Extract into a new module.

- **Effort:** M
- **Risks:** Overhead.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_quality "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "file");
  await Deno.remove(tmp);
});

Deno.test("validate_plan_quality: fails without effort estimate", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: Direct approach

- **Affected files:** \`src/handler.ts\`
- **Risks:** Tight coupling.

## Variant B: New module

- **Affected files:** \`src/module.ts\`
- **Risks:** Overhead.
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_quality "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "effort");
  await Deno.remove(tmp);
});

Deno.test("validate_plan_quality: fails without risk assessment", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Plan

## Variant A: Direct approach

- **Affected files:** \`src/handler.ts\`
- **Effort:** S

## Variant B: New module

- **Affected files:** \`src/module.ts\`
- **Effort:** M
`,
  );

  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_plan_quality "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "risk");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt() — constructs prompt from issue & spec data
// ============================================================

Deno.test("build_task_prompt: includes issue number and spec path", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 "/tmp/pipeline/42/01-spec.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "01-spec.md");
});

// ============================================================
// Script is executable and passes shellcheck
// ============================================================

Deno.test("stage-2-tech-lead.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-2-tech-lead.sh: passes shellcheck", async () => {
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
