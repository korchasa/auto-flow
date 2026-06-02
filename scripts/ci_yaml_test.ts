import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";

/**
 * FR-E78 regression locks on `.github/workflows/ci.yml`. We only assert
 * the shape the precondition story depends on (Windows binary,
 * sha256 sidecar, attach-binaries `dist/*` glob). Anything else in
 * the workflow is free to evolve.
 */

interface CiWorkflow {
  jobs: Record<string, {
    steps?: Array<Record<string, unknown>>;
    "runs-on"?: string;
  }>;
}

async function loadCi(): Promise<CiWorkflow> {
  const text = await Deno.readTextFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
  );
  return parseYaml(text) as CiWorkflow;
}

Deno.test("FR-E78 ci emits sha256 sidecars next to each binary", async () => {
  const ci = await loadCi();
  const build = ci.jobs.build;
  if (!build?.steps) throw new Error("build job missing or has no steps");

  // A dedicated sha256sum step must run after compile, writing
  // `<artifact>.sha256` next to the matrix artifact.
  const sha256Step = build.steps.find((step) => {
    const run = step.run;
    if (typeof run !== "string") return false;
    return run.includes("sha256sum") && run.includes(".sha256");
  });
  if (!sha256Step) {
    throw new Error("build job missing sha256sum step writing .sha256 sidecar");
  }
  const sha256Run = String(sha256Step.run);
  assertStringIncludes(sha256Run, "${{ matrix.artifact }}");
});

Deno.test("FR-E78 upload-artifact path covers both binary and sidecar", async () => {
  const ci = await loadCi();
  const build = ci.jobs.build;
  if (!build?.steps) throw new Error("build job missing or has no steps");
  const upload = build.steps.find((step) => {
    const uses = step.uses;
    return typeof uses === "string" &&
      uses.startsWith("actions/upload-artifact");
  });
  if (!upload) throw new Error("build job missing upload-artifact step");
  const withBlock = upload["with"] as Record<string, unknown> | undefined;
  if (!withBlock || typeof withBlock.path !== "string") {
    throw new Error("upload-artifact has no `path` field");
  }
  // The path pattern must catch BOTH the binary and the .sha256 sidecar
  // — otherwise the sidecar drops out of `dist/*` during attach-binaries.
  assertStringIncludes(withBlock.path, "${{ matrix.artifact }}");
  assertStringIncludes(withBlock.path, ".sha256");
});

Deno.test("FR-E78 attach-binaries job preserves dist/* glob", async () => {
  const ci = await loadCi();
  const publish = ci.jobs["publish-github"];
  if (!publish?.steps) throw new Error("publish-github job missing");
  const createRelease = publish.steps.find((step) => {
    const run = step.run;
    return typeof run === "string" && run.includes("gh release create");
  });
  if (!createRelease) {
    throw new Error("publish-github missing gh release create step");
  }
  // The trailing `dist/*` glob picks up binaries AND .sha256 sidecars
  // in a single atomic upload. Narrowing it would break FR-E78.
  assertStringIncludes(String(createRelease.run), "dist/*");
});

Deno.test("FR-E78 windows matrix entry exists in targets.json", async () => {
  const targets = JSON.parse(
    await Deno.readTextFile(new URL("./targets.json", import.meta.url)),
  );
  const win = targets.find((t: { target: string }) =>
    t.target === "x86_64-pc-windows-msvc"
  );
  assertEquals(win?.artifact, "flowai-workflow-windows-x86_64.exe");
});
