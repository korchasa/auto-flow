import { assertEquals } from "@std/assert";
import { checkArgs, nextPause, printUsage } from "./self_runner.ts";

Deno.test("nextPause doubles current value", () => {
  assertEquals(nextPause(30), 60);
  assertEquals(nextPause(60), 120);
});

Deno.test("nextPause caps at 4 hours", () => {
  const fourHours = 4 * 60 * 60;
  assertEquals(nextPause(fourHours), fourHours);
  assertEquals(nextPause(fourHours / 2), fourHours);
  assertEquals(nextPause(10000), fourHours);
});

Deno.test("nextPause progression from 30s", () => {
  const max = 4 * 60 * 60;
  const expected = [60, 120, 240, 480, 960, 1920, 3840, 7680, max];
  let p = 30;
  for (const exp of expected) {
    p = nextPause(p);
    assertEquals(p, exp);
  }
});

// --- printUsage ---

Deno.test("printUsage — contains Usage and deno task loop", () => {
  const text = printUsage();
  assertEquals(text.includes("Usage:"), true);
  assertEquals(text.includes("deno task loop"), true);
});

Deno.test("printUsage — mentions help flag", () => {
  const text = printUsage();
  assertEquals(text.includes("--help"), true);
});

// --- checkArgs ---

Deno.test("checkArgs — --help returns usage text with code 0", () => {
  const result = checkArgs(["--help"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task loop"), true);
});

Deno.test("checkArgs — -h returns usage text with code 0", () => {
  const result = checkArgs(["-h"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task loop"), true);
});

Deno.test("checkArgs — unknown --flag returns error string with code 1", () => {
  const result = checkArgs(["--unknown-flag"]);
  assertEquals(result?.code, 1);
  assertEquals(result?.text.includes("Unknown argument: --unknown-flag"), true);
  assertEquals(result?.text.includes("--help"), true);
});

Deno.test("checkArgs — positional args (interval) return null", () => {
  const result = checkArgs(["60"]);
  assertEquals(result, null);
});

Deno.test("checkArgs — -- stops flag scanning (passthrough ok)", () => {
  const result = checkArgs(["--", "--unknown"]);
  assertEquals(result, null);
});

Deno.test("checkArgs — empty args returns null", () => {
  const result = checkArgs([]);
  assertEquals(result, null);
});
