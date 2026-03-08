// Tests for stage-4-architect.sh — Stage 4 (Architect).
// Validates: argument parsing, YAML frontmatter, justification, shellcheck.
// See: requirements.md FR-5.

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

const SCRIPT_PATH = new URL("./stage-4-architect.sh", import.meta.url).pathname;
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

Deno.test("stage-4-architect: fails without issue number", async () => {
  const result = await runScript([]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "Usage");
});

Deno.test("stage-4-architect: fails with non-numeric issue number", async () => {
  const result = await runScript(["abc"]);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "numeric");
});

// ============================================================
// validate_yaml_frontmatter()
// ============================================================

Deno.test("validate_yaml_frontmatter: passes with valid frontmatter", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
variant: "Variant A"
tasks:
  - desc: "Add validation"
    files: ["src/validate.ts"]
  - desc: "Update config"
    files: ["src/config.ts"]
---

## Justification
Selected for simplicity.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_yaml_frontmatter "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_yaml_frontmatter: fails without --- start", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, `# Decision\nvariant: "A"\n`);
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_yaml_frontmatter "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "frontmatter");
  await Deno.remove(tmp);
});

Deno.test("validate_yaml_frontmatter: fails without variant field", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
tasks:
  - desc: "Do thing"
    files: ["src/a.ts"]
---
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_yaml_frontmatter "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "variant");
  await Deno.remove(tmp);
});

Deno.test("validate_yaml_frontmatter: fails without tasks field", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
variant: "Variant A"
---
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_yaml_frontmatter "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "tasks");
  await Deno.remove(tmp);
});

Deno.test("validate_yaml_frontmatter: fails on empty file", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(tmp, "");
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_yaml_frontmatter "${tmp}"`,
  );
  assertEquals(result.code, 1);
  await Deno.remove(tmp);
});

// ============================================================
// validate_justification()
// ============================================================

Deno.test("validate_justification: passes with vision reference", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
variant: "Variant A"
tasks:
  - desc: "Task"
    files: ["a.ts"]
---

## Justification

Selected because it aligns with the project vision in AGENTS.md.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_justification "${tmp}"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  await Deno.remove(tmp);
});

Deno.test("validate_justification: fails without justification section", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
variant: "A"
tasks:
  - desc: "Task"
    files: ["a.ts"]
---

## Task Breakdown
Do the thing.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_justification "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "justification");
  await Deno.remove(tmp);
});

Deno.test("validate_justification: fails without vision reference", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  await Deno.writeTextFile(
    tmp,
    `---
variant: "A"
tasks:
  - desc: "Task"
    files: ["a.ts"]
---

## Justification
Selected because it is simple and fast.
`,
  );
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && validate_justification "${tmp}"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "vision");
  await Deno.remove(tmp);
});

// ============================================================
// build_task_prompt()
// ============================================================

Deno.test("build_task_prompt: includes issue number and paths", async () => {
  const result = await runLib(
    `source "${SCRIPT_PATH}" --source-only && build_task_prompt 42 "/tmp/01-spec.md" "/tmp/03-revised-plan.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);
  assertStringIncludes(result.stdout, "42");
  assertStringIncludes(result.stdout, "01-spec.md");
  assertStringIncludes(result.stdout, "03-revised-plan.md");
});

// ============================================================
// Script quality
// ============================================================

Deno.test("stage-4-architect.sh: is executable", async () => {
  const info = await Deno.stat(SCRIPT_PATH);
  assertEquals((info.mode! & 0o111) !== 0, true, "Script must be executable");
});

Deno.test("stage-4-architect.sh: passes shellcheck", async () => {
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
