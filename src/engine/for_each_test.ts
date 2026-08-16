import { assertEquals, assertThrows } from "@std/assert";
import { parseForEachSource, slugifyKey } from "./for-each.ts";

Deno.test("FR-E90 parseForEachSource — one item per non-empty line", () => {
  assertEquals(
    parseForEachSource("src/a.ts\nsrc/b.ts\n\n  src/c.ts  \n"),
    ["src/a.ts", "src/b.ts", "src/c.ts"],
  );
});

Deno.test("FR-E90 parseForEachSource — JSON array of strings", () => {
  assertEquals(
    parseForEachSource('  ["one", "two", "three"]\n'),
    ["one", "two", "three"],
  );
});

Deno.test("FR-E90 parseForEachSource — JSON array of numbers stringifies", () => {
  assertEquals(parseForEachSource("[1, 2, 3]"), ["1", "2", "3"]);
});

Deno.test("FR-E90 parseForEachSource — an array of objects is rejected", () => {
  assertThrows(
    () => parseForEachSource('[{"path": "a.ts"}]'),
    Error,
    "must be strings or numbers",
  );
});

Deno.test("FR-E90 parseForEachSource — malformed JSON is rejected, not silently read as lines", () => {
  assertThrows(
    () => parseForEachSource('["unterminated'),
    Error,
    "starts with '[' but is not valid JSON",
  );
});

Deno.test("FR-E90 parseForEachSource — a JSON object is rejected", () => {
  assertThrows(
    () => parseForEachSource('{"a": 1}'),
    Error,
    "must be a JSON array or newline-separated",
  );
});

Deno.test("FR-E90 parseForEachSource — empty input yields no items", () => {
  assertEquals(parseForEachSource("   \n\n"), []);
  assertEquals(parseForEachSource("[]"), []);
});

Deno.test("FR-E90 slugifyKey — path separators and spaces become dashes", () => {
  assertEquals(slugifyKey("src/engine/loop.ts"), "src-engine-loop.ts");
  assertEquals(slugifyKey("Fix the CI  job"), "Fix-the-CI-job");
});

Deno.test("FR-E90 slugifyKey — never yields an empty or traversing key", () => {
  assertEquals(slugifyKey("../../etc/passwd"), "etc-passwd");
  assertEquals(slugifyKey("///"), "item");
  assertEquals(slugifyKey(""), "item");
});
