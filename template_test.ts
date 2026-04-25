import { assertEquals, assertThrows } from "@std/assert";
import {
  FILE_INCLUSION_SIZE_WARN_BYTES,
  interpolate,
  validateTemplateVars,
} from "./template.ts";
import type { TemplateContext } from "./types.ts";

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    node_dir: "/runs/20260308/spec",
    run_dir: "/runs/20260308",
    run_id: "20260308T143022",
    workDir: ".",
    args: { issue: "42" },
    env: { ANTHROPIC_API_KEY: "sk-test" },
    input: { pm: "/runs/20260308/pm" },
    ...overrides,
  };
}

Deno.test("interpolate — direct fields", () => {
  const ctx = makeCtx();
  assertEquals(interpolate("{{node_dir}}", ctx), "/runs/20260308/spec");
  assertEquals(interpolate("{{run_dir}}", ctx), "/runs/20260308");
  assertEquals(interpolate("{{run_id}}", ctx), "20260308T143022");
});

Deno.test("interpolate — args", () => {
  const ctx = makeCtx();
  assertEquals(interpolate("Issue #{{args.issue}}", ctx), "Issue #42");
});

Deno.test("interpolate — env", () => {
  const ctx = makeCtx();
  assertEquals(
    interpolate("Key: {{env.ANTHROPIC_API_KEY}}", ctx),
    "Key: sk-test",
  );
});

Deno.test("interpolate — input", () => {
  const ctx = makeCtx();
  assertEquals(
    interpolate("Read {{input.pm}}/spec.md", ctx),
    "Read /runs/20260308/pm/spec.md",
  );
});

Deno.test("interpolate — loop.iteration", () => {
  const ctx = makeCtx({ loop: { iteration: 2 } });
  assertEquals(interpolate("Iteration {{loop.iteration}}", ctx), "Iteration 2");
});

Deno.test("interpolate — multiple variables in one string", () => {
  const ctx = makeCtx();
  assertEquals(
    interpolate(
      "Run {{run_id}}: issue {{args.issue}} -> {{node_dir}}",
      ctx,
    ),
    "Run 20260308T143022: issue 42 -> /runs/20260308/spec",
  );
});

Deno.test("interpolate — no placeholders returns unchanged string", () => {
  const ctx = makeCtx();
  assertEquals(interpolate("no vars here", ctx), "no vars here");
});

Deno.test("interpolate — whitespace in placeholder is trimmed", () => {
  const ctx = makeCtx();
  assertEquals(interpolate("{{ node_dir }}", ctx), "/runs/20260308/spec");
  assertEquals(interpolate("{{ args.issue }}", ctx), "42");
});

Deno.test("interpolate — unknown direct variable throws", () => {
  const ctx = makeCtx();
  assertThrows(
    () => interpolate("{{unknown}}", ctx),
    Error,
    "Unknown template variable: {{unknown}}",
  );
});

Deno.test("interpolate — unknown args key throws", () => {
  const ctx = makeCtx();
  assertThrows(
    () => interpolate("{{args.missing}}", ctx),
    Error,
    "Unknown CLI argument",
  );
});

Deno.test("interpolate — unknown env key throws", () => {
  const ctx = makeCtx();
  assertThrows(
    () => interpolate("{{env.MISSING}}", ctx),
    Error,
    "Unknown env variable",
  );
});

Deno.test("interpolate — unknown input node throws", () => {
  const ctx = makeCtx();
  assertThrows(
    () => interpolate("{{input.nonexistent}}", ctx),
    Error,
    "Unknown input node",
  );
});

Deno.test("interpolate — loop.iteration outside loop throws", () => {
  const ctx = makeCtx(); // no loop property
  assertThrows(
    () => interpolate("{{loop.iteration}}", ctx),
    Error,
    "outside a loop context",
  );
});

Deno.test("interpolate — unknown loop property throws", () => {
  const ctx = makeCtx({ loop: { iteration: 1 } });
  assertThrows(
    () => interpolate("{{loop.count}}", ctx),
    Error,
    "Unknown loop property",
  );
});

Deno.test("interpolate — unknown prefix throws", () => {
  const ctx = makeCtx();
  assertThrows(
    () => interpolate("{{foo.bar}}", ctx),
    Error,
    "Unknown template variable prefix",
  );
});

Deno.test("interpolate — empty key after prefix throws", () => {
  const ctx = makeCtx();
  assertThrows(
    () => interpolate("{{args.}}", ctx),
    Error,
    "Empty key after prefix",
  );
});

// --- file() function tests (FR-E32) ---

Deno.test("interpolate — file() resolves to file content", () => {
  const tmpDir = Deno.makeTempDirSync();
  const filePath = `${tmpDir}/context.md`;
  Deno.writeTextFileSync(filePath, "# Context\nHello world");
  const ctx = makeCtx();
  assertEquals(
    interpolate(`{{file("${filePath}")}}`, ctx),
    "# Context\nHello world",
  );
});

Deno.test("interpolate — file() missing file throws descriptive error", () => {
  const ctx = makeCtx();
  const path = "/nonexistent/path/missing.md";
  assertThrows(
    () => interpolate(`{{file("${path}")}}`, ctx),
    Error,
    "file not found",
  );
});

Deno.test("interpolate — file() content with {{var}} is NOT re-interpolated", () => {
  const tmpDir = Deno.makeTempDirSync();
  const filePath = `${tmpDir}/template.md`;
  Deno.writeTextFileSync(filePath, "content with {{node_dir}} literal");
  const ctx = makeCtx();
  assertEquals(
    interpolate(`{{file("${filePath}")}}`, ctx),
    "content with {{node_dir}} literal",
  );
});

Deno.test("interpolate — file() mixed with other template vars", () => {
  const tmpDir = Deno.makeTempDirSync();
  const filePath = `${tmpDir}/context.md`;
  Deno.writeTextFileSync(filePath, "file content");
  const ctx = makeCtx();
  assertEquals(
    interpolate(`{{input.pm}} and {{file("${filePath}")}}`, ctx),
    "/runs/20260308/pm and file content",
  );
});

Deno.test("interpolate — file() emits console.warn for large file", () => {
  const tmpDir = Deno.makeTempDirSync();
  const filePath = `${tmpDir}/large.md`;
  Deno.writeTextFileSync(
    filePath,
    "x".repeat(FILE_INCLUSION_SIZE_WARN_BYTES + 1),
  );
  const ctx = makeCtx();
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warns.push(args.map(String).join(" "));
  try {
    interpolate(`{{file("${filePath}")}}`, ctx);
  } finally {
    console.warn = originalWarn;
  }
  assertEquals(warns.length, 1);
  assertEquals(warns[0].includes("large file"), true);
});

// --- validateTemplateVars tests (FR-E7) ---

Deno.test("validateTemplateVars — empty string returns no errors", () => {
  assertEquals(validateTemplateVars("", []), []);
});

Deno.test("validateTemplateVars — no placeholders returns no errors", () => {
  assertEquals(validateTemplateVars("git pull", []), []);
});

Deno.test("validateTemplateVars — valid direct keys return no errors", () => {
  assertEquals(
    validateTemplateVars("{{node_dir}} {{run_dir}} {{run_id}}", []),
    [],
  );
});

Deno.test("validateTemplateVars — valid input with known node returns no errors", () => {
  assertEquals(validateTemplateVars("{{input.pm}}", ["pm"]), []);
});

Deno.test("validateTemplateVars — input with unknown node returns error", () => {
  const errors = validateTemplateVars("{{input.nonexistent}}", ["pm"]);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("Unknown input node"), true);
});

Deno.test("validateTemplateVars — env and args are always valid", () => {
  assertEquals(
    validateTemplateVars("{{env.KEY}} {{args.issue}}", []),
    [],
  );
});

Deno.test("validateTemplateVars — loop.iteration is valid", () => {
  assertEquals(validateTemplateVars("{{loop.iteration}}", []), []);
});

Deno.test("validateTemplateVars — unknown loop property returns error", () => {
  const errors = validateTemplateVars("{{loop.count}}", []);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("Unknown loop property"), true);
});

Deno.test("validateTemplateVars — file() pattern is valid", () => {
  assertEquals(
    validateTemplateVars('{{file("/path/to/file.md")}}', []),
    [],
  );
});

Deno.test("validateTemplateVars — unknown prefix returns error", () => {
  const errors = validateTemplateVars("{{foo.bar}}", []);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("Unknown template variable prefix"), true);
});

Deno.test("validateTemplateVars — unknown direct key returns error", () => {
  const errors = validateTemplateVars("{{unknown_key}}", []);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].includes("Unknown template variable"), true);
});

Deno.test("validateTemplateVars — multiple errors accumulated", () => {
  const errors = validateTemplateVars("{{foo.bar}} {{baz}}", []);
  assertEquals(errors.length, 2);
});
