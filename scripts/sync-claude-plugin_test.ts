import { assertEquals } from "@std/assert";
import { decidePluginAction } from "./sync-claude-plugin.ts";

const PLUGIN_ID = "flowai-workflow@flowai-workflow-local";

Deno.test("FR-E70 decidePluginAction returns install when plugin absent", () => {
  assertEquals(decidePluginAction([], PLUGIN_ID), "install");
  assertEquals(
    decidePluginAction(
      [{ id: "other@flowai-workflow-local", scope: "user", enabled: true }],
      PLUGIN_ID,
    ),
    "install",
  );
});

Deno.test("FR-E70 decidePluginAction returns update for enabled user-scope match", () => {
  assertEquals(
    decidePluginAction(
      [{ id: PLUGIN_ID, scope: "user", enabled: true }],
      PLUGIN_ID,
    ),
    "update",
  );
});

Deno.test("FR-E70 decidePluginAction returns skip for disabled user-scope match", () => {
  assertEquals(
    decidePluginAction(
      [{ id: PLUGIN_ID, scope: "user", enabled: false }],
      PLUGIN_ID,
    ),
    "skip",
  );
});

Deno.test("FR-E70 decidePluginAction ignores non-user-scope entries", () => {
  assertEquals(
    decidePluginAction(
      [{ id: PLUGIN_ID, scope: "project", enabled: true }],
      PLUGIN_ID,
    ),
    "install",
  );
});

Deno.test("FR-E70 decidePluginAction ignores malformed entries", () => {
  assertEquals(
    decidePluginAction(
      [
        { id: 42, scope: "user", enabled: true },
        { scope: "user", enabled: true },
        { id: PLUGIN_ID, scope: "user", enabled: true },
      ],
      PLUGIN_ID,
    ),
    "update",
  );
});
