// Tests for stage-3-reviewer.sh — Stage 3 (Tech Lead Reviewer).
// Validates: argument parsing, section validation, critique coverage,
// recommendation validation, shellcheck.
// See: requirements.md FR-4.

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

const SCRIPT_PATH = new URL("./stage-3-reviewer.sh", import.meta.url).pathname;
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

Deno.test("stage-3-reviewer: fails without issue number", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-3-reviewer: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// validate_revised_plan_sections()
// ============================================================

Deno.test("validate_revised_plan_sections: passes with all 3 sections", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Revised Plan

## Critique

Issues found.

## Revised Plan

Updated variants.

## Recommendation

Variant A recommended.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_revised_plan_sections "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_revised_plan_sections: fails when Critique missing", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Revised Plan

## Revised Plan

Updated.

## Recommendation

Variant A.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_revised_plan_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Critique");
  await Deno.remove(tmp);
});

Deno.test("validate_revised_plan_sections: fails when Recommendation missing", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Revised Plan

## Critique

Issues found.

## Revised Plan

Updated.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_revised_plan_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Recommendation");
  await Deno.remove(tmp);
});

Deno.test("validate_revised_plan_sections: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_revised_plan_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// validate_critique_coverage()
// ============================================================

Deno.test("validate_critique_coverage: passes when all variants covered", async () => {
  const plan = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    plan,
    `## Variant A: Direct\nDetails.\n\n## Variant B: New module\nDetails.\n`,
  );
  const revised = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    revised,
    `## Critique\n\n### Variant A\nIssue found.\n\n### Variant B\nIssue found.\n\n## Revised Plan\nUpdated.\n\n## Recommendation\nVariant A.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_critique_coverage "${revised}" "${plan}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(plan);
  await Deno.remove(revised);
});

Deno.test("validate_critique_coverage: fails when variant not covered", async () => {
  const plan = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    plan,
    `## Variant A: Direct\nDetails.\n\n## Variant B: New module\nDetails.\n`,
  );
  const revised = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    revised,
    `## Critique\n\nSome general critique without variant refs.\n\n## Revised Plan\nUpdated.\n\n## Recommendation\nVariant A.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_critique_coverage "${revised}" "${plan}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "variant");
  await Deno.remove(plan);
  await Deno.remove(revised);
});

// ============================================================
// validate_recommendation()
// ============================================================

Deno.test("validate_recommendation: passes with variant reference", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `## Critique\nIssues.\n\n## Revised Plan\nUpdated.\n\n## Recommendation\n\nVariant A is recommended because it aligns with the spec.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_recommendation "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_recommendation: fails without variant reference", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `## Critique\nIssues.\n\n## Revised Plan\nUpdated.\n\n## Recommendation\n\nThe best approach is the direct one.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_recommendation "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "variant");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt()
// ============================================================

Deno.test("build_task_prompt: includes issue number and artifact paths", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 "/tmp/01-spec.md" "/tmp/02-plan.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "01-spec.md");
  assertStringIncludes(result.stdout, "02-plan.md");
});

// ============================================================
// Script quality
// ============================================================

Deno.test("stage-3-reviewer.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-3-reviewer.sh: passes shellcheck", async () => {
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
