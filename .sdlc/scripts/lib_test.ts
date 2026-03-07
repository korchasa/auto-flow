// Inline assertions to avoid network dependency on JSR/deno.land
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(
      msg ||
        `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertMatch(actual: string, pattern: RegExp, msg?: string): void {
  if (!pattern.test(actual)) {
    throw new Error(
      msg || `Expected "${actual}" to match ${pattern}`,
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

const LIB_PATH = new URL("./lib.sh", import.meta.url).pathname;

/** Run a bash snippet that sources lib.sh and executes the given code. */
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
// log()
// ============================================================

Deno.test("log: outputs formatted message to stderr", async () => {
  const result = await runLib('log INFO "hello world"');
  assertEquals(result.code, 0);
  assertMatch(result.stderr, /\[INFO\]\s+hello world/);
});

Deno.test("log: supports ERROR level", async () => {
  const result = await runLib('log ERROR "something broke"');
  assertEquals(result.code, 0);
  assertMatch(result.stderr, /\[ERROR\]\s+something broke/);
});

Deno.test("log: includes timestamp", async () => {
  const result = await runLib('log INFO "ts test"');
  // ISO-ish timestamp: YYYY-MM-DD or HH:MM:SS
  assertMatch(result.stderr, /\d{4}-\d{2}-\d{2}/);
});

// ============================================================
// validate_artifact()
// ============================================================

Deno.test("validate_artifact: succeeds for existing non-empty file", async () => {
  const tmp = await Deno.makeTempFile();
  await Deno.writeTextFile(tmp, "content");
  const result = await runLib(`validate_artifact "${tmp}"`);
  assertEquals(result.code, 0);
  await Deno.remove(tmp);
});

Deno.test("validate_artifact: fails for missing file", async () => {
  const result = await runLib(
    'validate_artifact "/tmp/nonexistent_sdlc_test_file"',
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "not found");
});

Deno.test("validate_artifact: fails for empty file", async () => {
  const tmp = await Deno.makeTempFile();
  await Deno.writeTextFile(tmp, "");
  const result = await runLib(`validate_artifact "${tmp}"`);
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "empty");
  await Deno.remove(tmp);
});

// ============================================================
// retry_with_backoff()
// ============================================================

Deno.test("retry_with_backoff: succeeds on first try", async () => {
  const result = await runLib('retry_with_backoff echo "ok"');
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "ok");
});

Deno.test("retry_with_backoff: retries on failure then succeeds", async () => {
  // Use a temp file as a counter: first two calls fail, third succeeds
  const tmp = await Deno.makeTempFile();
  await Deno.writeTextFile(tmp, "0");
  const script = `
    retry_with_backoff bash -c '
      count=$(cat "${tmp}")
      count=$((count + 1))
      echo $count > "${tmp}"
      if [ $count -lt 3 ]; then exit 1; fi
      echo "success"
    '
  `;
  // Use short delays for tests
  const result = await runLib(script, {
    SDLC_RETRY_INITIAL_DELAY: "0.1",
  });
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "success");
  await Deno.remove(tmp);
});

Deno.test("retry_with_backoff: fails after max attempts", async () => {
  const result = await runLib(
    "retry_with_backoff false",
    { SDLC_RETRY_INITIAL_DELAY: "0.1" },
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "failed after");
});

// ============================================================
// Config defaults (FR-15)
// ============================================================

Deno.test("config: SDLC_MAX_CONTINUATIONS defaults to 3", async () => {
  const result = await runLib("echo $SDLC_MAX_CONTINUATIONS");
  assertEquals(result.stdout.trim(), "3");
});

Deno.test("config: SDLC_MAX_QA_ITERATIONS defaults to 3", async () => {
  const result = await runLib("echo $SDLC_MAX_QA_ITERATIONS");
  assertEquals(result.stdout.trim(), "3");
});

Deno.test("config: SDLC_STAGE_TIMEOUT_MINUTES defaults to 30", async () => {
  const result = await runLib("echo $SDLC_STAGE_TIMEOUT_MINUTES");
  assertEquals(result.stdout.trim(), "30");
});

Deno.test("config: env vars override defaults", async () => {
  const result = await runLib(
    "echo $SDLC_MAX_CONTINUATIONS",
    { SDLC_MAX_CONTINUATIONS: "5" },
  );
  assertEquals(result.stdout.trim(), "5");
});

// ============================================================
// commit_artifacts()
// ============================================================

Deno.test("commit_artifacts: commits and pushes files", async () => {
  // Setup a temp git repo with a remote
  const dir = await Deno.makeTempDir();
  const remoteDir = await Deno.makeTempDir();
  const setup = `
    cd "${remoteDir}" && git init --bare &&
    cd "${dir}" && git init &&
    git remote add origin "${remoteDir}" &&
    git config user.email "test@test.com" &&
    git config user.name "Test" &&
    git config commit.gpgsign false &&
    echo "init" > file.txt && git add . && git commit -m "init" &&
    git push -u origin main 2>/dev/null || git push -u origin master 2>/dev/null
  `;
  await new Deno.Command("bash", {
    args: ["-c", setup],
    stdout: "piped",
    stderr: "piped",
  }).output();

  // Create a file to commit
  await Deno.writeTextFile(`${dir}/artifact.md`, "test content");

  const result = await runLib(
    `cd "${dir}" && git config commit.gpgsign false && commit_artifacts "test(pm): 1 — test commit" "${dir}/artifact.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);

  // Verify commit exists
  const verify = await new Deno.Command("bash", {
    args: ["-c", `cd "${dir}" && git log --oneline -1`],
    stdout: "piped",
  }).output();
  const log = new TextDecoder().decode(verify.stdout);
  assertStringIncludes(log, "test(pm): 1");

  await Deno.remove(dir, { recursive: true });
  await Deno.remove(remoteDir, { recursive: true });
});

// ============================================================
// report_status()
// ============================================================

Deno.test("report_status: calls gh with correct args (dry-run)", async () => {
  // Override gh with a mock that logs its args
  const tmp = await Deno.makeTempDir();
  const mockGh = `${tmp}/gh`;
  await Deno.writeTextFile(mockGh, '#!/bin/bash\necho "GH_CALL: $@"');
  await Deno.chmod(mockGh, 0o755);

  const result = await runLib(
    `export PATH="${tmp}:$PATH" && report_status 42 "Stage 1 complete"`,
  );
  assertEquals(result.code, 0);
  assertStringIncludes(result.stdout, "GH_CALL:");
  assertStringIncludes(result.stdout, "42");

  await Deno.remove(tmp, { recursive: true });
});

// ============================================================
// safety_check_diff()
// ============================================================

Deno.test("safety_check_diff: passes when changes are within allowlist", async () => {
  const dir = await Deno.makeTempDir();
  const setup = `
    cd "${dir}" && git init &&
    git config user.email "test@test.com" &&
    git config user.name "Test" &&
    git config commit.gpgsign false &&
    mkdir -p .sdlc/pipeline/1 &&
    echo "init" > .sdlc/pipeline/1/01-spec.md &&
    git add . && git commit -m "init" &&
    echo "updated" > .sdlc/pipeline/1/01-spec.md
  `;
  await new Deno.Command("bash", {
    args: ["-c", setup],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const result = await runLib(
    `cd "${dir}" && safety_check_diff ".sdlc/pipeline/1/01-spec.md"`,
  );
  assertEquals(result.code, 0, `stderr: ${result.stderr}`);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("safety_check_diff: fails when changes are outside allowlist", async () => {
  const dir = await Deno.makeTempDir();
  const setup = `
    cd "${dir}" && git init &&
    git config user.email "test@test.com" &&
    git config user.name "Test" &&
    git config commit.gpgsign false &&
    echo "init" > allowed.md &&
    echo "init" > forbidden.md &&
    git add . && git commit -m "init" &&
    echo "changed" > forbidden.md
  `;
  await new Deno.Command("bash", {
    args: ["-c", setup],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const result = await runLib(
    `cd "${dir}" && safety_check_diff "allowed.md"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "forbidden.md");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("safety_check_diff: detects secret-like patterns", async () => {
  const dir = await Deno.makeTempDir();
  const setup = `
    cd "${dir}" && git init &&
    git config user.email "test@test.com" &&
    git config user.name "Test" &&
    git config commit.gpgsign false &&
    echo "init" > code.ts &&
    git add . && git commit -m "init" &&
    echo 'const API_KEY = "sk-1234567890abcdef"' > code.ts
  `;
  await new Deno.Command("bash", {
    args: ["-c", setup],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const result = await runLib(
    `cd "${dir}" && safety_check_diff "code.ts"`,
  );
  assertEquals(result.code, 1);
  assertStringIncludes(result.stderr, "secret");

  await Deno.remove(dir, { recursive: true });
});
