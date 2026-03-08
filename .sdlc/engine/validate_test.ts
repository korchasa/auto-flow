import { assertEquals } from "jsr:@std/assert";
import {
  allPassed,
  formatFailures,
  runValidations,
} from "./validate.ts";
import type { TemplateContext, ValidationRule } from "./types.ts";

function makeCtx(nodeDir: string): TemplateContext {
  return {
    node_dir: nodeDir,
    run_dir: "/tmp/test-run",
    run_id: "test-run",
    args: {},
    env: {},
    input: {},
  };
}

Deno.test("file_exists — existing file passes", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/test.md`;
  await Deno.writeTextFile(filePath, "content");

  const rules: ValidationRule[] = [
    { type: "file_exists", path: filePath },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results.length, 1);
  assertEquals(results[0].passed, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("file_exists — missing file fails", async () => {
  const rules: ValidationRule[] = [
    { type: "file_exists", path: "/tmp/nonexistent-file-abc123.md" },
  ];
  const results = await runValidations(rules, makeCtx("/tmp"));

  assertEquals(results.length, 1);
  assertEquals(results[0].passed, false);
  assertEquals(results[0].message.includes("not found"), true);
});

Deno.test("file_not_empty — non-empty file passes", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/test.md`;
  await Deno.writeTextFile(filePath, "some content");

  const rules: ValidationRule[] = [
    { type: "file_not_empty", path: filePath },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("file_not_empty — empty file fails", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/empty.md`;
  await Deno.writeTextFile(filePath, "");

  const rules: ValidationRule[] = [
    { type: "file_not_empty", path: filePath },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, false);
  assertEquals(results[0].message.includes("empty"), true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("file_not_empty — missing file fails", async () => {
  const rules: ValidationRule[] = [
    { type: "file_not_empty", path: "/tmp/nonexistent-abc123.md" },
  ];
  const results = await runValidations(rules, makeCtx("/tmp"));

  assertEquals(results[0].passed, false);
});

Deno.test("contains_section — section found passes", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/doc.md`;
  await Deno.writeTextFile(
    filePath,
    "# Introduction\nSome text\n## Problem Statement\nDetails here\n",
  );

  const rules: ValidationRule[] = [
    { type: "contains_section", path: filePath, value: "Problem Statement" },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("contains_section — section not found fails", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/doc.md`;
  await Deno.writeTextFile(filePath, "# Introduction\nSome text\n");

  const rules: ValidationRule[] = [
    { type: "contains_section", path: filePath, value: "Missing Section" },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, false);
  assertEquals(results[0].message.includes("not found"), true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("contains_section — missing value fails", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/doc.md`;
  await Deno.writeTextFile(filePath, "# Title\n");

  const rules: ValidationRule[] = [
    { type: "contains_section", path: filePath },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, false);
  assertEquals(results[0].message.includes("requires 'value'"), true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("custom_script — passing script", async () => {
  const rules: ValidationRule[] = [
    { type: "custom_script", path: "true" },
  ];
  const results = await runValidations(rules, makeCtx("/tmp"));

  assertEquals(results[0].passed, true);
});

Deno.test("custom_script — failing script", async () => {
  const rules: ValidationRule[] = [
    { type: "custom_script", path: "false" },
  ];
  const results = await runValidations(rules, makeCtx("/tmp"));

  assertEquals(results[0].passed, false);
});

Deno.test("template variables in path are interpolated", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/output.md`;
  await Deno.writeTextFile(filePath, "content");

  const rules: ValidationRule[] = [
    { type: "file_exists", path: "{{node_dir}}/output.md" },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("allPassed — all pass returns true", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/test.md`;
  await Deno.writeTextFile(filePath, "content");

  const rules: ValidationRule[] = [
    { type: "file_exists", path: filePath },
    { type: "file_not_empty", path: filePath },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(allPassed(results), true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("allPassed — one failure returns false", async () => {
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/test.md`;
  await Deno.writeTextFile(filePath, "content");

  const rules: ValidationRule[] = [
    { type: "file_exists", path: filePath },
    { type: "file_exists", path: "/tmp/nonexistent-xyz.md" },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(allPassed(results), false);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("formatFailures — formats only failures", () => {
  const results = [
    {
      rule: { type: "file_exists" as const, path: "a.md" },
      passed: true,
      message: "File exists: a.md",
    },
    {
      rule: { type: "file_exists" as const, path: "b.md" },
      passed: false,
      message: "File not found: b.md",
    },
    {
      rule: { type: "file_not_empty" as const, path: "c.md" },
      passed: false,
      message: "File is empty: c.md",
    },
  ];
  const output = formatFailures(results);
  assertEquals(output, "- [file_exists] File not found: b.md\n- [file_not_empty] File is empty: c.md");
});

Deno.test("multiple rules — mixed results", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/exists.md`, "# Title\nContent");

  const rules: ValidationRule[] = [
    { type: "file_exists", path: `${tmpDir}/exists.md` },
    { type: "file_not_empty", path: `${tmpDir}/exists.md` },
    { type: "contains_section", path: `${tmpDir}/exists.md`, value: "Title" },
    { type: "file_exists", path: `${tmpDir}/missing.md` },
  ];
  const results = await runValidations(rules, makeCtx(tmpDir));

  assertEquals(results[0].passed, true);
  assertEquals(results[1].passed, true);
  assertEquals(results[2].passed, true);
  assertEquals(results[3].passed, false);

  await Deno.remove(tmpDir, { recursive: true });
});
