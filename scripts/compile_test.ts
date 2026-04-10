import { assertEquals } from "@std/assert";
import { stripVersionPrefix, TARGETS } from "./compile.ts";

Deno.test("TARGETS — has exactly 4 platform targets", () => {
  assertEquals(TARGETS.length, 4);
});

Deno.test("TARGETS — linux x86_64 maps to flowai-workflow-linux-x86_64", () => {
  const t = TARGETS.find((t) => t.target === "x86_64-unknown-linux-gnu");
  assertEquals(t?.artifact, "flowai-workflow-linux-x86_64");
});

Deno.test("TARGETS — linux arm64 maps to flowai-workflow-linux-arm64", () => {
  const t = TARGETS.find((t) => t.target === "aarch64-unknown-linux-gnu");
  assertEquals(t?.artifact, "flowai-workflow-linux-arm64");
});

Deno.test("TARGETS — darwin x86_64 maps to flowai-workflow-darwin-x86_64", () => {
  const t = TARGETS.find((t) => t.target === "x86_64-apple-darwin");
  assertEquals(t?.artifact, "flowai-workflow-darwin-x86_64");
});

Deno.test("TARGETS — darwin arm64 maps to flowai-workflow-darwin-arm64", () => {
  const t = TARGETS.find((t) => t.target === "aarch64-apple-darwin");
  assertEquals(t?.artifact, "flowai-workflow-darwin-arm64");
});

Deno.test("TARGETS — all artifacts follow flowai-workflow-<os>-<arch> naming convention", () => {
  for (const { artifact } of TARGETS) {
    assertEquals(
      artifact.startsWith("flowai-workflow-"),
      true,
      `${artifact} does not start with flowai-workflow-`,
    );
    const suffix = artifact.slice("flowai-workflow-".length);
    assertEquals(
      suffix.includes("-"),
      true,
      `${artifact} suffix "${suffix}" missing os-arch separator`,
    );
  }
});

Deno.test("TARGETS — matches scripts/targets.json on disk (single source of truth)", async () => {
  const json = JSON.parse(
    await Deno.readTextFile(new URL("./targets.json", import.meta.url)),
  );
  assertEquals(TARGETS, json);
});

Deno.test("stripVersionPrefix — strips leading v from version tag", () => {
  assertEquals(stripVersionPrefix("v1.2.3"), "1.2.3");
});

Deno.test("stripVersionPrefix — leaves plain version without v unchanged", () => {
  assertEquals(stripVersionPrefix("1.2.3"), "1.2.3");
});

Deno.test("stripVersionPrefix — dev default unchanged", () => {
  assertEquals(stripVersionPrefix("dev"), "dev");
});
