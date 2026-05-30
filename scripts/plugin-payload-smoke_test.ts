import { assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { validatePluginPayload } from "./plugin-payload-smoke.ts";

async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
}

Deno.test("FR-E72 payload smoke validates official host roots", async () => {
  const dir = await Deno.makeTempDir({ prefix: "payload-smoke-" });
  await writeJson(join(dir, "claude", ".claude-plugin", "marketplace.json"), {
    name: "flowai-workflow",
    plugins: [{
      name: "flowai-workflow",
      source: "./plugins/flowai-workflow",
      version: "1.2.3",
    }],
  });
  await writeJson(
    join(
      dir,
      "claude",
      "plugins",
      "flowai-workflow",
      ".claude-plugin",
      "plugin.json",
    ),
    { name: "flowai-workflow", version: "1.2.3" },
  );
  await writeJson(
    join(dir, "claude", "plugins", "flowai-workflow", ".mcp.json"),
    { mcpServers: { "flowai-workflow": { command: "deno", args: [] } } },
  );
  await writeJson(
    join(dir, "codex", ".agents", "plugins", "marketplace.json"),
    {
      name: "flowai-workflow",
      plugins: [{
        name: "flowai-workflow",
        source: { source: "local", path: "./plugins/flowai-workflow" },
        version: "1.2.3",
      }],
    },
  );
  await writeJson(
    join(
      dir,
      "codex",
      "plugins",
      "flowai-workflow",
      ".codex-plugin",
      "plugin.json",
    ),
    {
      name: "flowai-workflow",
      version: "1.2.3",
      mcpServers: "./.mcp.json",
    },
  );
  await writeJson(
    join(dir, "codex", "plugins", "flowai-workflow", ".mcp.json"),
    { "flowai-workflow": { command: "deno", args: [], cwd: "." } },
  );

  const result = await validatePluginPayload(dir);
  assertEquals(result.hosts.map((host) => host.host), ["claude", "codex"]);
  assertEquals(result.hosts.map((host) => host.hooks), [
    "no hooks declared",
    "no hooks declared",
  ]);
});

Deno.test("FR-E72 payload smoke rejects stale pre-split root only payload", async () => {
  const dir = await Deno.makeTempDir({ prefix: "payload-smoke-stale-" });
  await writeJson(join(dir, "plugins", "flowai-workflow", ".mcp.json"), {});
  await assertRejects(
    () => validatePluginPayload(dir),
    Error,
    "missing Claude marketplace",
  );
});
