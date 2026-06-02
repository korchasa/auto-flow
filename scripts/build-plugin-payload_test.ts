import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  buildPluginPayload,
  classifyPayloadFile,
  type HostKind,
  patchEngineDenoJson,
  substituteMarketplaceName,
  substituteVersion,
} from "./build-plugin-payload.ts";

Deno.test("FR-E70 substituteVersion replaces top-level version field", () => {
  const json = '{\n  "name": "x",\n  "version": "0.1.0"\n}\n';
  const { text, replaced } = substituteVersion(json, "9.9.9");
  assertEquals(replaced, true);
  assertStringIncludes(text, '"version": "9.9.9"');
});

Deno.test("FR-E70 substituteMarketplaceName rewrites top-level name only", () => {
  const json =
    '{\n  "name": "flowai-workflow",\n  "plugins": [\n    { "name": "flowai-workflow" }\n  ]\n}\n';
  const { text, replaced } = substituteMarketplaceName(
    json,
    "flowai-workflow-local",
  );
  assertEquals(replaced, true);
  assertStringIncludes(text, '"name": "flowai-workflow-local"');
  assertStringIncludes(text, '{ "name": "flowai-workflow" }');
});

Deno.test("FR-E70 classifyPayloadFile routes shared runtime into host plugin roots", () => {
  for (const host of ["claude", "codex"] as HostKind[]) {
    assertEquals(
      classifyPayloadFile(host, "plugin-src/shared/skills/run/SKILL.md"),
      join(host, "plugins/flowai-workflow/skills/run/SKILL.md"),
    );
    assertEquals(
      classifyPayloadFile(host, "plugin-src/shared/README.md"),
      join(host, "plugins/flowai-workflow/README.md"),
    );
  }
});

Deno.test("FR-E78 payload excludes launch.ts and engine ts sources", () => {
  for (const host of ["claude", "codex"] as HostKind[]) {
    // FR-E74 launcher is superseded by FR-E78 — the precondition model means
    // the engine binary is already on PATH, so the plugin payload no longer
    // ships either the launcher or the engine TS tree.
    assertEquals(
      classifyPayloadFile(host, "plugin-src/shared/bin/launch.ts"),
      null,
    );
    assertEquals(classifyPayloadFile(host, "cli.ts"), null);
    assertEquals(classifyPayloadFile(host, "engine.ts"), null);
    assertEquals(classifyPayloadFile(host, "init/mod.ts"), null);
    assertEquals(classifyPayloadFile(host, "deno.json"), null);
  }
});

Deno.test("FR-E76 codex drops shared agents, claude keeps them, codex skills route to codex only", () => {
  // Codex plugin manifest has no `agents` pointer (only skills/mcpServers/
  // apps), so shared agents are inert there and must not ship.
  assertEquals(
    classifyPayloadFile("codex", "plugin-src/shared/agents/orchestrator.md"),
    null,
  );
  assertEquals(
    classifyPayloadFile("codex", "plugin-src/shared/agents/supervisor.md"),
    null,
  );
  // Claude/OpenCode still ship the agents verbatim.
  assertEquals(
    classifyPayloadFile("claude", "plugin-src/shared/agents/orchestrator.md"),
    "claude/plugins/flowai-workflow/agents/orchestrator.md",
  );
  // The Codex operational skills live under plugin-src/codex/ and route to
  // the Codex host only (the existing host-prefix arm).
  assertEquals(
    classifyPayloadFile(
      "codex",
      "plugin-src/codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md",
    ),
    "codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md",
  );
  assertEquals(
    classifyPayloadFile(
      "claude",
      "plugin-src/codex/plugins/flowai-workflow/skills/supervisor/SKILL.md",
    ),
    null,
  );
});

Deno.test("FR-E70 classifyPayloadFile routes host-specific wiring only to that host", () => {
  assertEquals(
    classifyPayloadFile(
      "claude",
      "plugin-src/claude/.claude-plugin/marketplace.json",
    ),
    "claude/.claude-plugin/marketplace.json",
  );
  assertEquals(
    classifyPayloadFile(
      "claude",
      "plugin-src/claude/plugins/flowai-workflow/.mcp.json",
    ),
    "claude/plugins/flowai-workflow/.mcp.json",
  );
  assertEquals(
    classifyPayloadFile(
      "claude",
      "plugin-src/codex/.agents/plugins/marketplace.json",
    ),
    null,
  );
  assertEquals(
    classifyPayloadFile(
      "codex",
      "plugin-src/codex/.agents/plugins/marketplace.json",
    ),
    "codex/.agents/plugins/marketplace.json",
  );
  assertEquals(
    classifyPayloadFile(
      "codex",
      "plugin-src/codex/plugins/flowai-workflow/.mcp.json",
    ),
    "codex/plugins/flowai-workflow/.mcp.json",
  );
  assertEquals(
    classifyPayloadFile(
      "codex",
      "plugin-src/claude/.claude-plugin/marketplace.json",
    ),
    null,
  );
});

Deno.test("FR-E70 classifyPayloadFile routes engine and workflows under each host", () => {
  for (const host of ["claude", "codex"] as HostKind[]) {
    assertEquals(classifyPayloadFile(host, "cli_test.ts"), null);
    assertEquals(classifyPayloadFile(host, "scripts/check.ts"), null);
    assertEquals(classifyPayloadFile(host, "documents/index.md"), null);
    assertEquals(
      classifyPayloadFile(host, ".flowai-workflow/github-inbox/workflow.yaml"),
      join(
        host,
        "plugins/flowai-workflow/.flowai-workflow/github-inbox/workflow.yaml",
      ),
    );
    assertEquals(
      classifyPayloadFile(
        host,
        ".flowai-workflow/github-inbox/runs/1/state.json",
      ),
      null,
    );
    assertEquals(
      classifyPayloadFile(
        host,
        ".flowai-workflow/github-inbox/memory/agent-pm.md",
      ),
      null,
    );
  }
});

Deno.test("FR-E70 patchEngineDenoJson strips publish, version, dev tasks", () => {
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

async function tempEngine(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "build-payload-test-" });
  await Deno.mkdir(join(dir, "plugin-src/shared/bin"), { recursive: true });
  await Deno.mkdir(join(dir, "plugin-src/shared/skills/run"), {
    recursive: true,
  });
  await Deno.mkdir(join(dir, "plugin-src/shared/agents"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "plugin-src/shared/bin/launch.ts"),
    "#!/usr/bin/env -S deno run -A\nconsole.log('launch');\n",
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/shared/skills/run/SKILL.md"),
    "---\nname: run\n---\n",
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/shared/agents/supervisor.md"),
    "# Supervisor\n",
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/shared/README.md"),
    "# Plugin\n",
  );

  await Deno.mkdir(join(dir, "plugin-src/claude/.claude-plugin"), {
    recursive: true,
  });
  await Deno.mkdir(
    join(dir, "plugin-src/claude/plugins/flowai-workflow/.claude-plugin"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/claude/.claude-plugin/marketplace.json"),
    JSON.stringify({
      name: "flowai-workflow",
      plugins: [{
        name: "flowai-workflow",
        source: "./plugins/flowai-workflow",
        version: "0.0.0",
      }],
    }),
  );
  await Deno.writeTextFile(
    join(
      dir,
      "plugin-src/claude/plugins/flowai-workflow/.claude-plugin/plugin.json",
    ),
    JSON.stringify({ name: "flowai-workflow", version: "0.0.0" }),
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/claude/plugins/flowai-workflow/.mcp.json"),
    JSON.stringify({
      mcpServers: {
        "flowai-workflow": {
          command: "flowai-workflow",
          args: ["mcp"],
          cwd: "${CLAUDE_PROJECT_DIR}",
        },
      },
    }),
  );

  await Deno.mkdir(join(dir, "plugin-src/codex/.agents/plugins"), {
    recursive: true,
  });
  await Deno.mkdir(
    join(dir, "plugin-src/codex/plugins/flowai-workflow/.codex-plugin"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/codex/.agents/plugins/marketplace.json"),
    JSON.stringify({
      name: "flowai-workflow",
      interface: { displayName: "flowai-workflow" },
      plugins: [{
        name: "flowai-workflow",
        source: { source: "local", path: "./plugins/flowai-workflow" },
        version: "0.0.0",
      }],
    }),
  );
  await Deno.writeTextFile(
    join(
      dir,
      "plugin-src/codex/plugins/flowai-workflow/.codex-plugin/plugin.json",
    ),
    JSON.stringify({
      name: "flowai-workflow",
      version: "0.0.0",
      mcpServers: "./.mcp.json",
    }),
  );
  await Deno.writeTextFile(
    join(dir, "plugin-src/codex/plugins/flowai-workflow/.mcp.json"),
    JSON.stringify({
      "flowai-workflow": {
        command: "flowai-workflow",
        args: ["mcp"],
      },
    }),
  );
  await Deno.mkdir(
    join(dir, "plugin-src/codex/plugins/flowai-workflow/skills/orchestrator"),
    { recursive: true },
  );
  await Deno.writeTextFile(
    join(
      dir,
      "plugin-src/codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md",
    ),
    "---\nname: orchestrator\n---\nCodex orchestrator skill.\n",
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

const syntheticFiles = [
  "plugin-src/shared/bin/launch.ts",
  "plugin-src/shared/skills/run/SKILL.md",
  "plugin-src/shared/agents/supervisor.md",
  "plugin-src/shared/README.md",
  "plugin-src/claude/.claude-plugin/marketplace.json",
  "plugin-src/claude/plugins/flowai-workflow/.claude-plugin/plugin.json",
  "plugin-src/claude/plugins/flowai-workflow/.mcp.json",
  "plugin-src/codex/.agents/plugins/marketplace.json",
  "plugin-src/codex/plugins/flowai-workflow/.codex-plugin/plugin.json",
  "plugin-src/codex/plugins/flowai-workflow/.mcp.json",
  "plugin-src/codex/plugins/flowai-workflow/skills/orchestrator/SKILL.md",
  "cli.ts",
  "cli_test.ts",
  "init/mod.ts",
  "deno.json",
  ".flowai-workflow/wf1/workflow.yaml",
  ".flowai-workflow/wf1/runs/2024/state.json",
  ".flowai-workflow/wf1/memory/agent-pm.md",
  "README.md",
  "scripts/check.ts",
];

async function filesContainingText(
  root: string,
  needle: string,
): Promise<string[]> {
  const offenders: string[] = [];
  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) await walk(path);
      if (entry.isFile) {
        const text = await Deno.readTextFile(path);
        if (text.includes(needle)) offenders.push(path);
      }
    }
  }
  await walk(root);
  return offenders;
}

Deno.test("FR-E70 builds separate Claude and Codex plugin payloads from shared sources", async () => {
  const engineRoot = await tempEngine();
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    const result = await buildPluginPayload({
      engineRoot,
      outDir,
      version: "9.9.9",
      enumerateFiles: () => Promise.resolve(syntheticFiles),
    });

    for (const host of ["claude", "codex"] as HostKind[]) {
      const root = join(outDir, host, "plugins/flowai-workflow");
      // FR-E78: launch.ts and engine/ are dropped from the payload —
      // the precondition model assumes `flowai-workflow` is on PATH.
      await Deno.stat(join(root, "bin/launch.ts")).then(
        () => {
          throw new Error("FR-E78 payload must not ship bin/launch.ts");
        },
        (err) => {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        },
      );
      await Deno.stat(join(root, "engine")).then(
        () => {
          throw new Error("FR-E78 payload must not ship engine/ TS tree");
        },
        (err) => {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        },
      );
      assertStringIncludes(
        await Deno.readTextFile(join(root, "skills/run/SKILL.md")),
        "run",
      );
      if (host === "claude") {
        // Claude/OpenCode ship the agents; Codex must not (no `agents`
        // manifest pointer) and instead carries the operational skill.
        assertStringIncludes(
          await Deno.readTextFile(join(root, "agents/supervisor.md")),
          "Supervisor",
        );
        await Deno.stat(join(root, "skills/orchestrator/SKILL.md")).then(
          () => {
            throw new Error("claude payload should not carry codex skills");
          },
          (err) => {
            if (!(err instanceof Deno.errors.NotFound)) throw err;
          },
        );
      } else {
        assertStringIncludes(
          await Deno.readTextFile(join(root, "skills/orchestrator/SKILL.md")),
          "orchestrator",
        );
        await Deno.stat(join(root, "agents/supervisor.md")).then(
          () => {
            throw new Error("codex payload should not carry shared agents");
          },
          (err) => {
            if (!(err instanceof Deno.errors.NotFound)) throw err;
          },
        );
      }
      assertStringIncludes(
        await Deno.readTextFile(
          join(root, ".flowai-workflow/wf1/workflow.yaml"),
        ),
        "nodes: []",
      );
    }

    const claudeMarket = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "claude/.claude-plugin/marketplace.json"),
      ),
    );
    const codexMarket = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "codex/.agents/plugins/marketplace.json"),
      ),
    );
    assertEquals(claudeMarket.plugins[0].version, "9.9.9");
    assertEquals(codexMarket.plugins[0].version, "9.9.9");

    assertEquals(result.manifestsUpdated.length, 4);
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("FR-E78 plugin manifests invoke flowai-workflow mcp directly", async () => {
  const engineRoot = await tempEngine();
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    await buildPluginPayload({
      engineRoot,
      outDir,
      version: "0.1.0",
      enumerateFiles: () => Promise.resolve(syntheticFiles),
    });

    const claudeMcp = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "claude/plugins/flowai-workflow/.mcp.json"),
      ),
    );
    const claudeServer = claudeMcp.mcpServers["flowai-workflow"];
    assertEquals(claudeServer.command, "flowai-workflow");
    assertEquals(claudeServer.args, ["mcp"]);
    // No Deno-specific argv pollution.
    assertEquals(
      JSON.stringify(claudeServer).includes("launch.ts"),
      false,
    );
    assertEquals(
      JSON.stringify(claudeServer).includes("CLAUDE_PLUGIN_ROOT"),
      false,
    );

    const codexMcp = JSON.parse(
      await Deno.readTextFile(
        join(outDir, "codex/plugins/flowai-workflow/.mcp.json"),
      ),
    );
    const codexServer = codexMcp["flowai-workflow"];
    assertEquals(codexServer.command, "flowai-workflow");
    assertEquals(codexServer.args, ["mcp"]);
    assertEquals(JSON.stringify(codexServer).includes("launch.ts"), false);

    // Codex payload must remain free of Claude-specific env references.
    const offenders = await filesContainingText(
      join(outDir, "codex"),
      "CLAUDE_PLUGIN_ROOT",
    );
    assertEquals(offenders, []);
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});

Deno.test("FR-E74 codex payload keeps MCP config at plugin root", async () => {
  const engineRoot = await tempEngine();
  const outDir = await Deno.makeTempDir({ prefix: "build-payload-out-" });
  try {
    await buildPluginPayload({
      engineRoot,
      outDir,
      version: "0.1.0",
      marketplaceName: "flowai-workflow-local",
      enumerateFiles: () => Promise.resolve(syntheticFiles),
    });
    await Deno.stat(join(outDir, "codex/plugins/flowai-workflow/.mcp.json"));
    await Deno.stat(
      join(outDir, "codex/plugins/flowai-workflow/.codex-plugin/mcp.json"),
    ).then(
      () => {
        throw new Error("unexpected Codex MCP config under .codex-plugin");
      },
      (err) => {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      },
    );
  } finally {
    await Deno.remove(engineRoot, { recursive: true });
    await Deno.remove(outDir, { recursive: true });
  }
});
