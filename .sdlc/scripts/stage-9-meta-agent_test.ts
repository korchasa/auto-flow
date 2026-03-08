// Tests for stage-9-meta-agent.sh — Stage 9 (Meta-Agent).
// Validates: argument parsing, report validation, evidence check, shellcheck.
// See: requirements.md FR-11.

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

const SCRIPT_PATH = new URL("./stage-9-meta-agent.sh", import.meta.url)
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

Deno.test("stage-9-meta-agent: fails without issue number", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-9-meta-agent: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// validate_meta_report_sections()
// ============================================================

Deno.test("validate_meta_report_sections: passes with valid report", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Meta Report

## Run Summary

All 8 stages completed. 2 continuations total.

## Friction Points

Stage 2 required 1 continuation for variant count.

## Prompt Improvements Applied

Updated tech-lead.md to emphasize 2-3 variant requirement.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_meta_report_sections "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_meta_report_sections: fails without Run Summary", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Meta Report\n\n## Prompt Improvements\nSome changes.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_meta_report_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Run Summary");
  await Deno.remove(tmp);
});

Deno.test("validate_meta_report_sections: fails without Friction/Improvements", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Meta Report\n\n## Run Summary\nAll stages completed.\n\n## Notes\nNothing.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_meta_report_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

Deno.test("validate_meta_report_sections: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_meta_report_sections "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// validate_evidence_based()
// ============================================================

Deno.test("validate_evidence_based: passes with log references", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Report\n\nAnalysis of stage-2-tech-lead.json shows 3 turns used.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_evidence_based "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_evidence_based: fails without evidence", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `# Report\n\nEverything looks fine. No issues found.\n`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_evidence_based "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "evidence");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt()
// ============================================================

Deno.test("build_task_prompt: includes issue number", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "successfully");
});

Deno.test("build_task_prompt: includes failed stage info", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42`,
    { SDLC_FAILED_STAGE: "6" },
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "FAILED");
  assertStringIncludes(result.stdout, "6");
});

// ============================================================
// Script quality
// ============================================================

Deno.test("stage-9-meta-agent.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-9-meta-agent.sh: passes shellcheck", async () => {
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
