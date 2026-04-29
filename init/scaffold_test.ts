import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { copyTemplate, listTemplateFiles, unwindScaffold } from "./scaffold.ts";

// ---------------------------------------------------------------------------
// listTemplateFiles — walks a directory tree returning relative paths.
// ---------------------------------------------------------------------------

Deno.test("listTemplateFiles — walks a directory tree", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(tmp, "a"), { recursive: true });
    await Deno.mkdir(join(tmp, "b", "c"), { recursive: true });
    await Deno.writeTextFile(join(tmp, "root.md"), "x");
    await Deno.writeTextFile(join(tmp, "a", "one.md"), "x");
    await Deno.writeTextFile(join(tmp, "b", "c", "two.md"), "x");

    const files = (await listTemplateFiles(tmp)).sort();
    assertEquals(files, ["a/one.md", "b/c/two.md", "root.md"]);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// copyTemplate — verbatim copy into a tmp dir.
// ---------------------------------------------------------------------------

async function buildFakeWorkflow(root: string): Promise<void> {
  await Deno.mkdir(join(root, "agents"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "workflow.yaml"),
    'name: "demo"\nversion: "1"\n',
  );
  await Deno.writeTextFile(
    join(root, "agents", "agent-pm.md"),
    "# PM\n\nPrompt body — left untouched.\n",
  );
  await Deno.writeTextFile(
    join(root, ".gitignore"),
    "runs/\n",
  );
}

Deno.test("copyTemplate — copies workflow tree verbatim", async () => {
  const source = await Deno.makeTempDir();
  const target = await Deno.makeTempDir();
  try {
    await buildFakeWorkflow(source);
    const created = await copyTemplate(source, target);

    const workflow = await Deno.readTextFile(join(target, "workflow.yaml"));
    assertEquals(workflow, 'name: "demo"\nversion: "1"\n');

    const agent = await Deno.readTextFile(
      join(target, "agents", "agent-pm.md"),
    );
    assertEquals(agent, "# PM\n\nPrompt body — left untouched.\n");

    const gi = await Deno.readTextFile(join(target, ".gitignore"));
    assertEquals(gi, "runs/\n");

    // createdPaths must include every written file (for unwind).
    const denormalized = created.map((p) => p.replace(target + "/", ""));
    for (
      const expected of [
        "workflow.yaml",
        join("agents", "agent-pm.md"),
        ".gitignore",
      ]
    ) {
      if (!denormalized.includes(expected)) {
        throw new Error(
          `createdPaths missing ${expected}: ${JSON.stringify(denormalized)}`,
        );
      }
    }
  } finally {
    await Deno.remove(source, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("copyTemplate — fails if target file already exists", async () => {
  const source = await Deno.makeTempDir();
  const target = await Deno.makeTempDir();
  try {
    await buildFakeWorkflow(source);
    await Deno.writeTextFile(
      join(target, "workflow.yaml"),
      "pre-existing",
    );

    await assertRejects(
      () => copyTemplate(source, target),
      Error,
      "already exists",
    );
  } finally {
    await Deno.remove(source, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("copyTemplate — fails when source is missing", async () => {
  const target = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => copyTemplate("/tmp/definitely-not-there-xyz-init-test", target),
      Error,
      "Workflow source missing",
    );
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("copyTemplate — preserves placeholder-shaped strings verbatim", async () => {
  // Without substitution, `__FOO__` tokens must round-trip unchanged. This
  // guards against accidentally re-introducing placeholder logic.
  const source = await Deno.makeTempDir();
  const target = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(source, "demo.md"),
      "name: __NOT_A_PLACEHOLDER__\n",
    );
    await copyTemplate(source, target);
    const out = await Deno.readTextFile(join(target, "demo.md"));
    assertEquals(out, "name: __NOT_A_PLACEHOLDER__\n");
  } finally {
    await Deno.remove(source, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// unwindScaffold — deletes tracked paths in reverse order.
// ---------------------------------------------------------------------------

Deno.test("unwindScaffold — removes only tracked files", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const trackedFile = join(tmp, "tracked.md");
    const untrackedFile = join(tmp, "untracked.md");
    await Deno.writeTextFile(trackedFile, "x");
    await Deno.writeTextFile(untrackedFile, "x");

    await unwindScaffold([trackedFile]);

    const untrackedStat = await Deno.stat(untrackedFile);
    assertEquals(untrackedStat.isFile, true);

    let missing = false;
    try {
      await Deno.stat(trackedFile);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) missing = true;
    }
    assertEquals(missing, true);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("unwindScaffold — silent on already-missing paths", async () => {
  await unwindScaffold(["/tmp/definitely-not-there-12345"]);
});
