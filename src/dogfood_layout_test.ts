/**
 * @module
 * Dogfood-only sanity tests for the multi-workflow layout (FR-S47/DoD-2).
 *
 * Asserts that this repository hosts exactly the four expected workflow
 * folders directly under `.flowai-workflow/`, each with a `workflow.yaml`,
 * and that no stray files or other directories live at that level.
 *
 * These tests target the engine's own dogfood configuration; they do NOT
 * gate end-user projects (which may have any number of workflow folders
 * and only need to satisfy {@link assertWorkflowFolderShape}).
 */

import { assertEquals } from "@std/assert";

const EXPECTED_WORKFLOWS = [
  "autonomous-sdlc",
  "github-inbox",
  "github-inbox-opencode",
  "github-inbox-opencode-test",
] as const;

Deno.test(
  "dogfood — `.flowai-workflow/` contains only the four workflow folders",
  async () => {
    const entries: { name: string; isDir: boolean; isFile: boolean }[] = [];
    for await (const e of Deno.readDir(".flowai-workflow")) {
      entries.push({
        name: e.name,
        isDir: e.isDirectory,
        isFile: e.isFile,
      });
    }
    // No files at top level (all runtime/scripts/memory are now nested).
    const files = entries.filter((e) => e.isFile);
    assertEquals(files, []);

    // Exactly the three expected dirs.
    const dirs = entries.filter((e) => e.isDir).map((e) => e.name).sort();
    assertEquals(dirs, [...EXPECTED_WORKFLOWS]);
  },
);

Deno.test(
  "dogfood — every workflow folder has a workflow.yaml",
  async () => {
    for (const name of EXPECTED_WORKFLOWS) {
      const path = `.flowai-workflow/${name}/workflow.yaml`;
      const stat = await Deno.stat(path);
      assertEquals(stat.isFile, true, `expected file at ${path}`);
    }
  },
);
