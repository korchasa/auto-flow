import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  buildPluginPayload,
  classifyPayloadFile,
  patchEngineDenoJson,
  substituteMarketplaceName,
  substituteVersion,
} from "./build-plugin-payload.ts";

// ---------------------------------------------------------------------------
// substituteVersion — pure JSON-text patcher.
// ---------------------------------------------------------------------------

Deno.test("FR-E70 substituteVersion — replaces top-level version field", () => {
  const json = '{\n  "name": "x",\n  "version": "0.1.0"\n}\n';
  const { text, replaced } = substituteVersion(json, "9.9.9");
  assertEquals(replaced, true);
  assertStringIncludes(text, '"version": "9.9.9"');
});

Deno.test("FR-E70 substituteVersion — no field present returns input unchanged", () => {
  const json = '{\n  "name": "x"\n}\n';
  const { text, replaced } = substituteVersion(json, "9.9.9");
  assertEquals(replaced, false);
  assertEquals(text, json);
});

Deno.test("FR-E70 substituteVersion — preserves surrounding whitespace and comma", () => {
  const json = '{\n  "version": "1.2.3",\n  "name": "x"\n}\n';
  const { text } = substituteVersion(json, "9.9.9");
  assertStringIncludes(text, '"version": "9.9.9",');
  assertStringIncludes(text, '"name": "x"');
});

Deno.test("FR-E70 substituteMarketplaceName — rewrites top-level name only", () => {
  const json =
    '{\n  "name": "flowai-workflow",\n  "plugins": [\n    { "name": "flowai-workflow" }\n  ]\n}\n';
  const { text, replaced } = substituteMarketplaceName(
    json,
    "flowai-workflow-local",
  );
  assertEquals(replaced, true);
  assertStringIncludes(text, '"name": "flowai-workflow-local"');
  // Plugin-level name is left intact (only the FIRST "name" matches).
  assertStringIncludes(text, '{ "name": "flowai-workflow" }');
});

Deno.test("FR-E70 substituteMarketplaceName — no field present returns input unchanged", () => {
  const json = '{\n  "version": "0.1.0"\n}\n';
  const { text, replaced } = substituteMarketplaceName(json, "anything");
  assertEquals(replaced, false);
  assertEquals(text, json);
});

// ---------------------------------------------------------------------------
// classifyPayloadFile — payload-shape regressions live here.
// ---------------------------------------------------------------------------

Deno.test("FR-E70 classifyPayloadFile — claude-plugin/ files copy verbatim", () => {
  assertEquals(
    classifyPayloadFile("claude-plugin/.claude-plugin/marketplace.json"),
    ".claude-plugin/marketplace.json",
  );
  assertEquals(
    classifyPayloadFile(
      "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
    ),
    "plugins/flowai-workflow/.claude-plugin/plugin.json",
  );
  assertEquals(
    classifyPayloadFile(
      "claude-plugin/plugins/flowai-workflow/skills/run/SKILL.md",
    ),
    "plugins/flowai-workflow/skills/run/SKILL.md",
  );
});

Deno.test("FR-E70 classifyPayloadFile — engine TS files land under engine/", () => {
  assertEquals(
    classifyPayloadFile("cli.ts"),
    "plugins/flowai-workflow/engine/cli.ts",
  );
  assertEquals(
    classifyPayloadFile("init/mod.ts"),
    "plugins/flowai-workflow/engine/init/mod.ts",
  );
});

Deno.test("FR-E70 classifyPayloadFile — _test.ts files are skipped", () => {
  assertEquals(classifyPayloadFile("cli_test.ts"), null);
  assertEquals(classifyPayloadFile("init/mod_test.ts"), null);
});

Deno.test("FR-E70 classifyPayloadFile — scripts/, .claude/, documents/ excluded", () => {
  assertEquals(classifyPayloadFile("scripts/check.ts"), null);
  assertEquals(classifyPayloadFile(".claude/hooks/guard-deno-direct.ts"), null);
  assertEquals(classifyPayloadFile("documents/index.md"), null);
});

Deno.test("FR-E70 classifyPayloadFile — bundled workflows preserve .flowai-workflow prefix", () => {
  assertEquals(
    classifyPayloadFile(".flowai-workflow/github-inbox/workflow.yaml"),
    "plugins/flowai-workflow/.flowai-workflow/github-inbox/workflow.yaml",
  );
  assertEquals(
    classifyPayloadFile(
      ".flowai-workflow/github-inbox/agents/agent-pm.md",
    ),
    "plugins/flowai-workflow/.flowai-workflow/github-inbox/agents/agent-pm.md",
  );
});

Deno.test("FR-E70 classifyPayloadFile — per-run dirt excluded", () => {
  assertEquals(
    classifyPayloadFile(
      ".flowai-workflow/github-inbox/runs/20260524T120000/state.json",
    ),
    null,
  );
  assertEquals(
    classifyPayloadFile(
      ".flowai-workflow/github-inbox/memory/agent-pm.md",
    ),
    null,
  );
  assertEquals(
    classifyPayloadFile(".flowai-workflow/github-inbox/.template.json"),
    null,
  );
});

Deno.test("FR-E70 classifyPayloadFile — root deno.json travels with engine", () => {
  assertEquals(
    classifyPayloadFile("deno.json"),
    "plugins/flowai-workflow/engine/deno.json",
  );
});

Deno.test("FR-E70 classifyPayloadFile — non-runtime files skipped", () => {
  assertEquals(classifyPayloadFile("README.md"), null);
  assertEquals(classifyPayloadFile("AGENTS.md"), null);
  assertEquals(classifyPayloadFile(".gitignore"), null);
});

// ---------------------------------------------------------------------------
// patchEngineDenoJson — publish + dev tasks stripped.
// ---------------------------------------------------------------------------

Deno.test("FR-E70 patchEngineDenoJson — strips publish, version, dev tasks", () => {
  const src = JSON.stringify({
    name: "@korchasa/flowai-workflow",
    version: "0.7.12",
    publish: { include: ["./"], exclude: ["scripts/**"] },
    imports: { foo: "jsr:foo" },
    tasks: {
      test: "deno test -A",
      "test:lib": "deno test -A lib",
      compile: "deno run -A scripts/compile.ts",
      release: "deno run -A npm:standard-version",
      check: "deno run -A scripts/check.ts",
    },
  });
  const patched = JSON.parse(patchEngineDenoJson(src));
  assertEquals(patched.publish, undefined);
  assertEquals(patched.version, undefined);
  assertEquals(patched.imports.foo, "jsr:foo");
  assertEquals(patched.tasks.test, "deno test -A");
  assertEquals(patched.tasks["test:lib"], "deno test -A lib");
  assertEquals(patched.tasks.compile, undefined);
  assertEquals(patched.tasks.release, undefined);
  assertEquals(patched.tasks.check, undefined);
});

// ---------------------------------------------------------------------------
// buildPluginPayload — integration over a synthetic file list.
// ---------------------------------------------------------------------------

async function tempEngine(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "build-payload-test-" });
  // Seed manifests + a fake engine source + a fake bundled workflow so
  // the copy operations have real bytes to read.
  await Deno.mkdir(join(dir, "claude-plugin/.claude-plugin"), {
    recursive: true,
  });
  await Deno.writeTextFile(
    join(dir, "claude-plugin/.claude-plugin/marketplace.json"),
    JSON.stringify({
      name: "flowai-workflow",
      owner: { name: "korchasa" },
      plugins: [{ name: "flowai-workflow", source: ".", version: "0.0.0" }],
    }),
  );
  await Deno.mkdir(
    join(
      dir,
      "claude-plugin/plugins/flowai-workflow/.claude-plugin",
    ),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(
      dir,
      "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
    ),
    JSON.stringify({ name: "flowai-workflow", version: "0.0.0" }),
  );
  await Deno.mkdir(join(dir, "init"), { recursive: true });
  await Deno.writeTextFile(join(dir, "cli.ts"), 'export const x = "cli";\n');
  await Deno.writeTextFile(
    join(dir, "init/mod.ts"),
    'export const m = "init";\n',
  );
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    JSON.stringify({
      name: "@korchasa/flowai-workflow",
      version: "0.0.0",
      publish: { include: ["./"] },
      tasks: { test: "deno test", compile: "echo skip" },
    }),
  );
  await Deno.mkdir(join(dir, ".flowai-workflow/wf1"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".flowai-workflow/wf1/workflow.yaml"),
    "nodes: []\n",
  );
  return dir;
}

Deno.test("FR-E70 buildPluginPayload — wires manifests, engine, workflows", async () => {
  const engineRoot = await tempEngine();
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    const result = await buildPluginPayload({
      engineRoot,
      outDir,
      version: "9.9.9",
      enumerateFiles: () =>
        Promise.resolve([
          "claude-plugin/.claude-plugin/marketplace.json",
          "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
          "cli.ts",
          "cli_test.ts", // should be skipped
          "init/mod.ts",
          "deno.json",
          ".flowai-workflow/wf1/workflow.yaml",
          ".flowai-workflow/wf1/runs/2024/state.json", // skipped (per-run)
          ".flowai-workflow/wf1/memory/agent-pm.md", // skipped (memory snapshot)
          "README.md", // skipped (non-runtime)
          "scripts/check.ts", // skipped
        ]),
    });

    // Manifests landed at expected paths with the new version.
    const market = JSON.parse(
      await Deno.readTextFile(
        join(outDir, ".claude-plugin/marketplace.json"),
      ),
    );
    assertEquals(market.plugins[0].version, "9.9.9");
    const plugin = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "plugins/flowai-workflow/.claude-plugin/plugin.json"),
      ),
    );
    assertEquals(plugin.version, "9.9.9");

    // Engine source landed under engine/.
    const cliBody = await Deno.readTextFile(
      join(outDir, "plugins/flowai-workflow/engine/cli.ts"),
    );
    assertStringIncludes(cliBody, "cli");
    const initBody = await Deno.readTextFile(
      join(outDir, "plugins/flowai-workflow/engine/init/mod.ts"),
    );
    assertStringIncludes(initBody, "init");

    // engine/deno.json patched: no publish, no version, dev tasks dropped.
    const engineDeno = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "plugins/flowai-workflow/engine/deno.json"),
      ),
    );
    assertEquals(engineDeno.publish, undefined);
    assertEquals(engineDeno.version, undefined);
    assertEquals(engineDeno.tasks.test, "deno test");
    assertEquals(engineDeno.tasks.compile, undefined);

    // Bundled workflow landed under .flowai-workflow/<name>/.
    const wf = await Deno.readTextFile(
      join(
        outDir,
        "plugins/flowai-workflow/.flowai-workflow/wf1/workflow.yaml",
      ),
    );
    assertStringIncludes(wf, "nodes: []");

    // Skipped files are not on disk.
    for (
      const skipped of [
        "plugins/flowai-workflow/engine/cli_test.ts",
        "plugins/flowai-workflow/.flowai-workflow/wf1/runs/2024/state.json",
        "plugins/flowai-workflow/.flowai-workflow/wf1/memory/agent-pm.md",
        "README.md",
      ]
    ) {
      let exists = true;
      try {
        await Deno.stat(join(outDir, skipped));
      } catch {
        exists = false;
      }
      assertEquals(exists, false, `expected ${skipped} to be skipped`);
    }

    // Build summary surfaces both manifest updates.
    assertEquals(result.manifestsUpdated.length, 2);
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("FR-E70 buildPluginPayload — version lockstep verified across both manifests", async () => {
  const engineRoot = await tempEngine();
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    await buildPluginPayload({
      engineRoot,
      outDir,
      version: "1.2.3",
      enumerateFiles: () =>
        Promise.resolve([
          "claude-plugin/.claude-plugin/marketplace.json",
          "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
          "deno.json",
        ]),
    });
    const market = JSON.parse(
      await Deno.readTextFile(
        join(outDir, ".claude-plugin/marketplace.json"),
      ),
    );
    const plugin = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "plugins/flowai-workflow/.claude-plugin/plugin.json"),
      ),
    );
    assertEquals(market.plugins[0].version, "1.2.3");
    assertEquals(plugin.version, "1.2.3");
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("FR-E74 payload includes launcher with executable bit", async () => {
  const engineRoot = await tempEngine();
  // Seed a launcher script in the source tree so the build can copy it.
  await Deno.mkdir(
    join(engineRoot, "claude-plugin/plugins/flowai-workflow/bin"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(engineRoot, "claude-plugin/plugins/flowai-workflow/bin/launch.sh"),
    "#!/usr/bin/env bash\necho stub\n",
  );
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    await buildPluginPayload({
      engineRoot,
      outDir,
      version: "0.1.0",
      enumerateFiles: () =>
        Promise.resolve([
          "claude-plugin/.claude-plugin/marketplace.json",
          "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
          "claude-plugin/plugins/flowai-workflow/bin/launch.sh",
        ]),
    });
    const dst = join(outDir, "plugins/flowai-workflow/bin/launch.sh");
    const body = await Deno.readTextFile(dst);
    assertStringIncludes(body, "#!/usr/bin/env bash");
    // Executable bit set (POSIX hosts only — skip mode check on Windows).
    if (Deno.build.os !== "windows") {
      const stat = await Deno.stat(dst);
      // mode bits: 0o100 = owner-execute.
      const mode = stat.mode ?? 0;
      assertEquals(
        (mode & 0o100) === 0o100,
        true,
        `expected owner-execute bit; mode=${mode.toString(8)}`,
      );
    }
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("FR-E74 payload includes .mcp.json with launcher wiring", async () => {
  const engineRoot = await tempEngine();
  await Deno.writeTextFile(
    join(engineRoot, "claude-plugin/plugins/flowai-workflow/.mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          "flowai-workflow": {
            command: "bash",
            args: ["${CLAUDE_PLUGIN_ROOT}/bin/launch.sh", "mcp"],
          },
        },
      },
      null,
      2,
    ),
  );
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    await buildPluginPayload({
      engineRoot,
      outDir,
      version: "0.1.0",
      enumerateFiles: () =>
        Promise.resolve([
          "claude-plugin/.claude-plugin/marketplace.json",
          "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
          "claude-plugin/plugins/flowai-workflow/.mcp.json",
        ]),
    });
    const mcpConfig = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "plugins/flowai-workflow/.mcp.json"),
      ),
    );
    assertEquals(
      mcpConfig.mcpServers["flowai-workflow"].command,
      "bash",
    );
    assertEquals(
      mcpConfig.mcpServers["flowai-workflow"].args,
      ["${CLAUDE_PLUGIN_ROOT}/bin/launch.sh", "mcp"],
    );
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("FR-E70 buildPluginPayload — excludes per-run dirt even when enumerator returns it", async () => {
  const engineRoot = await tempEngine();
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  // Add fake dirt files so copyFile would succeed if classifyPayloadFile
  // failed to filter them out.
  await Deno.mkdir(
    join(engineRoot, ".flowai-workflow/wf1/runs/2024"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(engineRoot, ".flowai-workflow/wf1/runs/2024/state.json"),
    "{}",
  );
  await Deno.mkdir(
    join(engineRoot, ".flowai-workflow/wf1/memory"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(engineRoot, ".flowai-workflow/wf1/memory/agent-pm.md"),
    "stale",
  );
  await Deno.writeTextFile(
    join(engineRoot, ".flowai-workflow/wf1/.template.json"),
    "{}",
  );
  try {
    const result = await buildPluginPayload({
      engineRoot,
      outDir,
      version: "0.0.1",
      enumerateFiles: () =>
        Promise.resolve([
          "claude-plugin/.claude-plugin/marketplace.json",
          "claude-plugin/plugins/flowai-workflow/.claude-plugin/plugin.json",
          ".flowai-workflow/wf1/workflow.yaml",
          ".flowai-workflow/wf1/runs/2024/state.json",
          ".flowai-workflow/wf1/memory/agent-pm.md",
          ".flowai-workflow/wf1/.template.json",
        ]),
    });
    const writtenSuffixes = result.filesWritten.map((p) => p.split("/").pop());
    if (writtenSuffixes.includes("state.json")) {
      throw new Error(
        `runs/state.json leaked into payload: ${result.filesWritten}`,
      );
    }
    if (writtenSuffixes.includes("agent-pm.md")) {
      throw new Error(`memory/agent-*.md leaked: ${result.filesWritten}`);
    }
    if (writtenSuffixes.includes(".template.json")) {
      throw new Error(`.template.json leaked: ${result.filesWritten}`);
    }
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});
