import { assertEquals } from "@std/assert";
import { loadBundledSkills } from "./mod.ts";

Deno.test("loadBundledSkills: loads init and adapt-agents skills", async () => {
  const skills = await loadBundledSkills();
  const names = skills.map((s) => s.frontmatter.name).sort();
  assertEquals(names, ["flowai-workflow-adapt-agents", "flowai-workflow-init"]);
});

Deno.test("loadBundledSkills: init skill has correct metadata", async () => {
  const skills = await loadBundledSkills();
  const init = skills.find((s) =>
    s.frontmatter.name === "flowai-workflow-init"
  );
  assertEquals(init !== undefined, true);
  assertEquals(
    init!.frontmatter.description.includes("Initialize"),
    true,
  );
  assertEquals(init!.frontmatter["user-invocable"], true);
  assertEquals(init!.body.length > 0, true);
  assertEquals(init!.files, []);
});

Deno.test("loadBundledSkills: adapt-agents skill has correct metadata", async () => {
  const skills = await loadBundledSkills();
  const adapt = skills.find((s) =>
    s.frontmatter.name === "flowai-workflow-adapt-agents"
  );
  assertEquals(adapt !== undefined, true);
  assertEquals(
    adapt!.frontmatter.description.includes("Adapt"),
    true,
  );
  assertEquals(adapt!.frontmatter["user-invocable"], true);
});
