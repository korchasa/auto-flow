import { assertEquals, assertThrows } from "@std/assert";
import { assignKeys, parseBranchSource, slugifyKey } from "./branch.ts";

Deno.test("FR-E95 parseBranchSource — one item per non-empty line", () => {
  assertEquals(
    parseBranchSource("src/a.ts\nsrc/b.ts\n\n  src/c.ts  \n"),
    ["src/a.ts", "src/b.ts", "src/c.ts"],
  );
});

Deno.test("FR-E95 parseBranchSource — JSON array of strings", () => {
  assertEquals(
    parseBranchSource('  ["one", "two", "three"]\n'),
    ["one", "two", "three"],
  );
});

Deno.test("FR-E95 parseBranchSource — JSON array of numbers stringifies", () => {
  assertEquals(parseBranchSource("[1, 2, 3]"), ["1", "2", "3"]);
});

Deno.test("FR-E95 parseBranchSource — an array of objects is kept as objects", () => {
  assertEquals(
    parseBranchSource('[{"id": "a", "paths": "src/a/**"}]'),
    [{ id: "a", paths: "src/a/**" }],
  );
});

Deno.test("FR-E95 parseBranchSource — null and nested arrays are rejected", () => {
  assertThrows(
    () => parseBranchSource("[null]"),
    Error,
    "item 0",
  );
  assertThrows(
    () => parseBranchSource("[[1]]"),
    Error,
    "item 0",
  );
});

Deno.test("FR-E95 parseBranchSource — malformed JSON is rejected, not silently read as lines", () => {
  assertThrows(
    () => parseBranchSource('["unterminated'),
    Error,
    "starts with '[' but is not valid JSON",
  );
});

Deno.test("FR-E95 parseBranchSource — a JSON object is rejected", () => {
  assertThrows(
    () => parseBranchSource('{"a": 1}'),
    Error,
    "must be a JSON array or newline-separated",
  );
});

Deno.test("FR-E95 parseBranchSource — empty input yields no items", () => {
  assertEquals(parseBranchSource("   \n\n"), []);
  assertEquals(parseBranchSource("[]"), []);
});

Deno.test("FR-E95 slugifyKey — path separators and spaces become dashes", () => {
  assertEquals(slugifyKey("src/engine/loop.ts"), "src-engine-loop.ts");
  assertEquals(slugifyKey("Fix the CI  job"), "Fix-the-CI-job");
});

Deno.test("FR-E95 slugifyKey — never yields an empty or traversing key", () => {
  assertEquals(slugifyKey("../../etc/passwd"), "etc-passwd");
  assertEquals(slugifyKey("///"), "item");
  assertEquals(slugifyKey(""), "item");
});

Deno.test("FR-E95 assignKeys — no key path numbers the branches", () => {
  assertEquals(
    assignKeys(["a", "b"], undefined),
    [{ index: 0, value: "a", key: "0" }, { index: 1, value: "b", key: "1" }],
  );
});

Deno.test("FR-E95 assignKeys — `value` slugifies a scalar item", () => {
  assertEquals(
    assignKeys(["src/a.ts"], "value"),
    [{ index: 0, value: "src/a.ts", key: "src-a.ts" }],
  );
});

Deno.test("FR-E95 assignKeys — `value.<field>` reads the field of an object item", () => {
  assertEquals(
    assignKeys([{ id: "fix auth" }, { id: "fix ci" }], "value.id"),
    [
      { index: 0, value: { id: "fix auth" }, key: "fix-auth" },
      { index: 1, value: { id: "fix ci" }, key: "fix-ci" },
    ],
  );
});

Deno.test("FR-E95 assignKeys — a missing key field names the offending index", () => {
  assertThrows(
    () => assignKeys([{ id: "a" }, { name: "b" }], "value.id"),
    Error,
    "item 1",
  );
});

Deno.test("FR-E95 assignKeys — a non-string key field is rejected", () => {
  assertThrows(
    () => assignKeys([{ id: 7 }], "value.id"),
    Error,
    "item 0",
  );
});

Deno.test("FR-E95 assignKeys — a duplicate key after slugification is rejected", () => {
  assertThrows(
    () => assignKeys([{ id: "a/b" }, { id: "a b" }], "value.id"),
    Error,
    "duplicate branch key",
  );
});

Deno.test("FR-E95 assignKeys — `value` on an object item is rejected", () => {
  assertThrows(
    () => assignKeys([{ id: "a" }], "value"),
    Error,
    "item 0",
  );
});
