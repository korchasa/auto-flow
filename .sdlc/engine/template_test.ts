import { assertEquals, assertThrows } from "jsr:@std/assert";
import { interpolate } from "./template.ts";
import type { TemplateContext } from "./types.ts";

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    node_dir: "/runs/20260308/spec",
    run_dir: "/runs/20260308",
    run_id: "20260308T143022",
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
