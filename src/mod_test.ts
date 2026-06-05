/**
 * Barrel-coverage smoke tests. mod.ts is the `deno doc --lint` entry point
 * (FR-E26) and the static re-export anchor for `deno publish` slow-types
 * analysis (FR-E73). These tests assert that the public symbols required by
 * those contracts are actually exported and have the expected shape.
 */

import { assertEquals } from "@std/assert";
import { applyJsonPointerOp, runMcpServer } from "./mod.ts";

Deno.test("FR-E73 mod reexports runMcpServer as a function", () => {
  assertEquals(typeof runMcpServer, "function");
});

Deno.test("FR-E73 mod reexports applyJsonPointerOp as a function", () => {
  assertEquals(typeof applyJsonPointerOp, "function");
});
