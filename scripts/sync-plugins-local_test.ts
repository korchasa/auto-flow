import { assertEquals, assertThrows } from "@std/assert";
import {
  autoInstallEnabled,
  ENV_AUTO_INSTALL_PLUGINS,
  parseAndStripFlowaiTables,
  parseArgs,
  planClaudeActions,
  readMarketplacePluginNames,
  reconcileCodexFlowaiPluginEntries,
  shouldAutoInstall,
} from "./sync-plugins-local.ts";

// ---------------------------------------------------------------------------
// autoInstallEnabled / shouldAutoInstall
// ---------------------------------------------------------------------------

Deno.test("FR-E72 autoInstallEnabled accepts only literal true", () => {
  assertEquals(autoInstallEnabled("AUTO_INSTALL_PLUGINS=true"), true);
  assertEquals(autoInstallEnabled('AUTO_INSTALL_PLUGINS="true"'), true);
  assertEquals(autoInstallEnabled("AUTO_INSTALL_PLUGINS=True"), false);
  assertEquals(autoInstallEnabled("AUTO_INSTALL_PLUGINS=TRUE"), false);
  assertEquals(autoInstallEnabled("AUTO_INSTALL_PLUGINS=1"), false);
  assertEquals(autoInstallEnabled("AUTO_INSTALL_PLUGINS=yes"), false);
  assertEquals(autoInstallEnabled("AUTO_INSTALL_PLUGINS="), false);
  assertEquals(autoInstallEnabled(""), false);
  assertEquals(autoInstallEnabled("# AUTO_INSTALL_PLUGINS=true"), false);
});

Deno.test("FR-E72 shouldAutoInstall env var wins over dotenv", async () => {
  const prev = Deno.env.get(ENV_AUTO_INSTALL_PLUGINS);
  const tmp = await Deno.makeTempFile({ suffix: ".env" });
  try {
    await Deno.writeTextFile(tmp, "AUTO_INSTALL_PLUGINS=false\n");
    Deno.env.set(ENV_AUTO_INSTALL_PLUGINS, "true");
    assertEquals(await shouldAutoInstall(tmp), true);
    Deno.env.delete(ENV_AUTO_INSTALL_PLUGINS);
    assertEquals(await shouldAutoInstall(tmp), false);
  } finally {
    if (prev === undefined) Deno.env.delete(ENV_AUTO_INSTALL_PLUGINS);
    else Deno.env.set(ENV_AUTO_INSTALL_PLUGINS, prev);
    await Deno.remove(tmp).catch(() => {});
  }
});

Deno.test("FR-E72 shouldAutoInstall missing dotenv is disabled", async () => {
  const prev = Deno.env.get(ENV_AUTO_INSTALL_PLUGINS);
  Deno.env.delete(ENV_AUTO_INSTALL_PLUGINS);
  try {
    const result = await shouldAutoInstall(
      "/tmp/this-path-does-not-exist-12345.env",
    );
    assertEquals(result, false);
  } finally {
    if (prev !== undefined) Deno.env.set(ENV_AUTO_INSTALL_PLUGINS, prev);
  }
});

Deno.test("FR-E72 shouldAutoInstall rejects non-true env values", async () => {
  const prev = Deno.env.get(ENV_AUTO_INSTALL_PLUGINS);
  try {
    for (const v of ["1", "yes", "True", "TRUE", ""]) {
      Deno.env.set(ENV_AUTO_INSTALL_PLUGINS, v);
      assertEquals(
        await shouldAutoInstall("/tmp/this-path-does-not-exist-12345.env"),
        false,
        `env value ${JSON.stringify(v)} must NOT enable auto-install`,
      );
    }
  } finally {
    if (prev === undefined) Deno.env.delete(ENV_AUTO_INSTALL_PLUGINS);
    else Deno.env.set(ENV_AUTO_INSTALL_PLUGINS, prev);
  }
});

// ---------------------------------------------------------------------------
// parseAndStripFlowaiTables / reconcileCodexFlowaiPluginEntries
// ---------------------------------------------------------------------------

Deno.test("FR-E72 parseAndStripFlowaiTables strips tables and captures enabled", () => {
  const input = [
    "# top-level user config",
    "[other.section]",
    "key = 1",
    "",
    '[plugins."foo@flowai-workflow-local"]',
    "enabled = true   # inline comment",
    "extra = 42",
    "",
    '[plugins."bar@flowai-workflow-local"]',
    "enabled = false",
    "",
    "[mcp_servers.something]",
    'command = "x"',
    "",
  ].join("\r\n");
  const { stripped, previousEnabled } = parseAndStripFlowaiTables(input);
  // Both flowai tables removed.
  if (stripped.includes("flowai-workflow")) {
    throw new Error(
      `expected stripped text to drop flowai tables: ${stripped}`,
    );
  }
  // Unrelated sections preserved.
  if (!stripped.includes("[other.section]")) {
    throw new Error("expected [other.section] preserved");
  }
  if (!stripped.includes("[mcp_servers.something]")) {
    throw new Error("expected [mcp_servers.something] preserved");
  }
  assertEquals(previousEnabled.get("foo"), true);
  assertEquals(previousEnabled.get("bar"), false);
});

Deno.test("FR-E72 parseAndStripFlowaiTables ignores published marketplace tables", () => {
  // A user with both the official `flowai-workflow` install AND the local
  // dogfood `flowai-workflow-local` install must keep the official entry
  // untouched — only the local marketplace's tables are managed here.
  const input = [
    '[plugins."flowai-workflow@flowai-workflow"]',
    "enabled = true",
    "",
    '[plugins."flowai-workflow@flowai-workflow-local"]',
    "enabled = false",
    "",
  ].join("\n");
  const { stripped, previousEnabled } = parseAndStripFlowaiTables(input);
  if (!stripped.includes('[plugins."flowai-workflow@flowai-workflow"]')) {
    throw new Error(`expected official entry preserved: ${stripped}`);
  }
  if (stripped.includes("flowai-workflow-local")) {
    throw new Error(`expected local entry stripped: ${stripped}`);
  }
  assertEquals(previousEnabled.get("flowai-workflow"), false);
});

Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries refuses empty emitted", () => {
  assertThrows(
    () => reconcileCodexFlowaiPluginEntries("", []),
    Error,
    "empty emittedNames",
  );
});

Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries preserves enabled=false", () => {
  const input = [
    '[plugins."flowai-workflow@flowai-workflow-local"]',
    "enabled = false",
    "",
  ].join("\n");
  const result = reconcileCodexFlowaiPluginEntries(input, ["flowai-workflow"]);
  if (!result.includes('[plugins."flowai-workflow@flowai-workflow-local"]')) {
    throw new Error(`expected table re-emitted: ${result}`);
  }
  if (!/enabled = false/.test(result)) {
    throw new Error(`expected enabled = false preserved: ${result}`);
  }
});

Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries defaults new plugins to true", () => {
  const result = reconcileCodexFlowaiPluginEntries(
    "[other]\nkey = 1\n",
    ["flowai-workflow"],
  );
  if (!result.includes('[plugins."flowai-workflow@flowai-workflow-local"]')) {
    throw new Error(`expected new table emitted: ${result}`);
  }
  if (!/enabled = true/.test(result)) {
    throw new Error(`expected enabled = true default: ${result}`);
  }
  if (!result.includes("[other]")) {
    throw new Error(`expected unrelated section preserved: ${result}`);
  }
});

Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries idempotent on equal input", () => {
  const initial = "[other]\nkey = 1\n";
  const first = reconcileCodexFlowaiPluginEntries(initial, [
    "flowai-workflow",
  ]);
  const second = reconcileCodexFlowaiPluginEntries(first, ["flowai-workflow"]);
  assertEquals(first, second);
});

Deno.test("FR-E72 reconcileCodexFlowaiPluginEntries leaves published marketplace tables intact", () => {
  // The local script must not touch the official-marketplace entries.
  const input = [
    '[plugins."flowai-workflow@flowai-workflow"]',
    "enabled = true",
    "",
  ].join("\n");
  const result = reconcileCodexFlowaiPluginEntries(input, ["flowai-workflow"]);
  if (!result.includes('[plugins."flowai-workflow@flowai-workflow"]')) {
    throw new Error(`expected official entry preserved: ${result}`);
  }
  if (!result.includes('[plugins."flowai-workflow@flowai-workflow-local"]')) {
    throw new Error(`expected local entry added alongside: ${result}`);
  }
});

// ---------------------------------------------------------------------------
// readMarketplacePluginNames
// ---------------------------------------------------------------------------

Deno.test("FR-E72 readMarketplacePluginNames rejects empty plugins", () => {
  assertThrows(
    () => readMarketplacePluginNames(JSON.stringify({ plugins: [] })),
    Error,
    "zero plugins",
  );
});

Deno.test("FR-E72 readMarketplacePluginNames rejects missing plugins array", () => {
  assertThrows(
    () => readMarketplacePluginNames("{}"),
    Error,
    "missing a top-level `plugins`",
  );
});

Deno.test("FR-E72 readMarketplacePluginNames sorts and dedups", () => {
  const json = JSON.stringify({
    plugins: [
      { name: "zebra" },
      { name: "alpha" },
      { name: "alpha" },
      { name: "mango" },
    ],
  });
  assertEquals(readMarketplacePluginNames(json), ["alpha", "mango", "zebra"]);
});

// ---------------------------------------------------------------------------
// planClaudeActions
// ---------------------------------------------------------------------------

Deno.test("FR-E72 planClaudeActions buckets disabled plugins as skipped", () => {
  const plan = planClaudeActions(
    ["flowai-workflow"],
    [
      {
        id: "flowai-workflow@flowai-workflow-local",
        scope: "user",
        enabled: false,
      },
    ],
  );
  assertEquals(plan.skipped, ["flowai-workflow@flowai-workflow-local"]);
  assertEquals(plan.install, []);
});

Deno.test("FR-E72 planClaudeActions installs newly emitted plugins", () => {
  const plan = planClaudeActions(["flowai-workflow"], []);
  assertEquals(plan.install, ["flowai-workflow@flowai-workflow-local"]);
  assertEquals(plan.skipped, []);
});

Deno.test("FR-E72 planClaudeActions ignores non-user-scope disable", () => {
  const plan = planClaudeActions(
    ["flowai-workflow"],
    [
      {
        id: "flowai-workflow@flowai-workflow-local",
        scope: "project",
        enabled: false,
      },
    ],
  );
  // Project-scope disabled state must not affect user-scope install.
  assertEquals(plan.install, ["flowai-workflow@flowai-workflow-local"]);
  assertEquals(plan.skipped, []);
});

Deno.test("FR-E72 planClaudeActions ignores official-marketplace disable", () => {
  // Disabling the OFFICIAL flowai-workflow install must not skip the
  // LOCAL one — they live under different marketplace ids.
  const plan = planClaudeActions(
    ["flowai-workflow"],
    [
      {
        id: "flowai-workflow@flowai-workflow",
        scope: "user",
        enabled: false,
      },
    ],
  );
  assertEquals(plan.install, ["flowai-workflow@flowai-workflow-local"]);
  assertEquals(plan.skipped, []);
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

Deno.test("FR-E72 parseArgs defaults outDir + no skipBuild", () => {
  assertEquals(parseArgs([]), {
    outDir: "dist/plugin-payload",
    skipBuild: false,
  });
});

Deno.test("FR-E72 parseArgs honours --out + --no-build", () => {
  assertEquals(parseArgs(["--out", "tmp/out", "--no-build"]), {
    outDir: "tmp/out",
    skipBuild: true,
  });
});

Deno.test("FR-E72 parseArgs fail-fast on missing --out value", () => {
  assertThrows(() => parseArgs(["--out"]), Error, "--out requires");
  assertThrows(
    () => parseArgs(["--out", "--no-build"]),
    Error,
    "--out requires",
  );
});

Deno.test("FR-E72 parseArgs rejects unknown args", () => {
  assertThrows(() => parseArgs(["--bogus"]), Error, "Unknown argument");
});
