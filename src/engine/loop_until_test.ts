import { assertEquals, assertRejects } from "@std/assert";
import { evaluateUntilPredicate } from "./loop.ts";
import type { TemplateContext } from "../types.ts";

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    node_dir: "runs/r1/n1",
    run_dir: "runs/r1",
    run_id: "r1",
    workDir: ".",
    args: {},
    env: {},
    input: {},
    ...overrides,
  };
}

Deno.test("FR-E87 evaluateUntilPredicate — exit 0 means the loop may stop", async () => {
  const result = await evaluateUntilPredicate("true", ctx());
  assertEquals(result.satisfied, true);
  assertEquals(result.code, 0);
});

Deno.test("FR-E87 evaluateUntilPredicate — non-zero exit keeps the loop running", async () => {
  const result = await evaluateUntilPredicate("exit 3", ctx());
  assertEquals(result.satisfied, false);
  assertEquals(result.code, 3);
});

Deno.test("FR-E87 evaluateUntilPredicate — interpolates loop.iteration", async () => {
  const onSecond = 'test "{{loop.iteration}}" = "2"';
  const first = await evaluateUntilPredicate(
    onSecond,
    ctx({ loop: { iteration: 1 } }),
  );
  assertEquals(first.satisfied, false);

  const second = await evaluateUntilPredicate(
    onSecond,
    ctx({ loop: { iteration: 2 } }),
  );
  assertEquals(second.satisfied, true);
});

Deno.test("FR-E87 evaluateUntilPredicate — interpolates node_dir", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/marker.txt`, "ok\n");
    const result = await evaluateUntilPredicate(
      'test -f "{{node_dir}}/marker.txt"',
      ctx({ node_dir: dir }),
    );
    assertEquals(result.satisfied, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E87 evaluateUntilPredicate — runs in the supplied cwd", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/inside.txt`, "ok\n");
    const inside = await evaluateUntilPredicate(
      "test -f inside.txt",
      ctx(),
      dir,
    );
    assertEquals(inside.satisfied, true);

    const outside = await evaluateUntilPredicate("test -f inside.txt", ctx());
    assertEquals(outside.satisfied, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("FR-E87 evaluateUntilPredicate — unresolved template variable fails fast", async () => {
  await assertRejects(
    () => evaluateUntilPredicate('test "{{args.missing}}" = "1"', ctx()),
    Error,
    "Unknown CLI argument",
  );
});

Deno.test("FR-E87 evaluateUntilPredicate — captures stderr for diagnostics", async () => {
  const result = await evaluateUntilPredicate(
    "echo boom >&2; exit 1",
    ctx(),
  );
  assertEquals(result.satisfied, false);
  assertEquals(result.stderr.trim(), "boom");
});
