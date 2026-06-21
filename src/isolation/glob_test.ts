import { assertEquals } from "@std/assert";
import { globMatch } from "./glob.ts";

Deno.test("globMatch — `**` spans multiple path segments", () => {
  assertEquals(globMatch("src/**", "src/a/b/c.ts"), true);
  assertEquals(globMatch("**/*.md", "docs/notes/x.md"), true);
  assertEquals(globMatch("memory/**", "memory/agent-pm.md"), true);
  assertEquals(globMatch("src/**", "lib/a.ts"), false);
});

Deno.test("globMatch — `*` stays within one path segment", () => {
  assertEquals(globMatch("*.md", "README.md"), true);
  assertEquals(globMatch("*.md", "docs/README.md"), false);
  assertEquals(globMatch("src/*.ts", "src/a.ts"), true);
  assertEquals(globMatch("src/*.ts", "src/sub/a.ts"), false);
});

Deno.test("globMatch — `?` matches exactly one non-separator character", () => {
  assertEquals(globMatch("file-?.txt", "file-1.txt"), true);
  assertEquals(globMatch("file-?.txt", "file-12.txt"), false);
  assertEquals(globMatch("a?c", "a/c"), false);
});

Deno.test("globMatch — literal characters; dots are not wildcards", () => {
  assertEquals(globMatch("a.ts", "a.ts"), true);
  assertEquals(globMatch("a.ts", "aXts"), false);
});
