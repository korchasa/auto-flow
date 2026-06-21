import { assertEquals } from "@std/assert";
import {
  buildTaskPaths,
  getNodeDir,
  getRunDir,
  workPath,
} from "../state/state.ts";
import { interpolate } from "./template.ts";
import type { TemplateContext } from "../types.ts";

/**
 * Recursively yield absolute paths of every `.ts` file under `dir`.
 * The FR-E52 guardrails below scan the whole engine source tree (`src/`),
 * which is split into domain subfolders (`engine/`, `config/`, `state/`, …);
 * a flat `Deno.readDir` of one folder would miss offenders elsewhere.
 */
async function* walkTs(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkTs(path);
    } else if (entry.isFile && entry.name.endsWith(".ts")) {
      yield path;
    }
  }
}

/** Absolute path of the `src/` root (this test lives in `src/config/`). */
const SRC_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// Regression: see documents/tasks/2026-04-26-engine-cwd-relative-template-paths.md
//
// The bug was that ctx.node_dir / ctx.run_dir / ctx.input.<id> were emitted
// pre-prefixed with workDir (a path relative to the engine's cwd).
// Agents launched with cwd = workDir then resolved that relative path against
// workDir again — producing a doubly-nested non-existent path. Some agents
// "fixed" the broken path to an absolute path anchored at the project root,
// which silently leaked memory writes outside the worktree.
//
// Contract under test: paths in TemplateContext are workDir-RELATIVE; engine
// internal code joins them to workDir explicitly via workPath().

Deno.test("buildTaskPaths — node_dir is workDir-relative (no worktree prefix)", () => {
  const paths = buildTaskPaths("20260426T120000", "verify");
  assertEquals(
    paths.node_dir,
    getNodeDir("20260426T120000", "verify"),
  );
  // Sanity: workDir is not embedded.
  assertEquals(paths.node_dir.startsWith(".flowai-workflow/runs/"), true);
});

Deno.test("buildTaskPaths — run_dir is workDir-relative", () => {
  const paths = buildTaskPaths("20260426T120000", "verify");
  assertEquals(paths.run_dir, getRunDir("20260426T120000"));
});

Deno.test("buildTaskPaths — input map keys to workDir-relative node dirs", () => {
  const paths = buildTaskPaths("20260426T120000", "verify", [
    "specification",
    "decision",
  ]);
  assertEquals(
    paths.input.specification,
    getNodeDir("20260426T120000", "specification"),
  );
  assertEquals(
    paths.input.decision,
    getNodeDir("20260426T120000", "decision"),
  );
});

Deno.test("buildTaskPaths — empty inputs yields empty input map", () => {
  const paths = buildTaskPaths("R", "n");
  assertEquals(paths.input, {});
});

Deno.test("interpolate — rendered {{node_dir}} contains no worktree prefix even when workDir is a worktree", () => {
  // Simulate the issue #196 v3 scenario.
  const workDir = ".flowai-workflow/example/runs/20260425T222337/worktree";
  const paths = buildTaskPaths("20260425T222337", "verify");
  const ctx: TemplateContext = {
    ...paths,
    workDir,
    run_id: "20260425T222337",
    args: {},
    env: {},
    loop: undefined,
  };

  const rendered = interpolate("Read {{node_dir}}/05-qa-report.md", ctx);

  // Must NOT contain the worktree prefix — that would mean cwd=workDir
  // double-resolves into .../<workDir>/<workDir>/... non-existent path.
  assertEquals(rendered.includes(workDir), false);
  assertEquals(
    rendered,
    "Read .flowai-workflow/runs/20260425T222337/verify/05-qa-report.md",
  );
});

Deno.test("interpolate — rendered {{input.X}} contains no worktree prefix", () => {
  const workDir = ".flowai-workflow/example/runs/20260425T222337/worktree";
  const paths = buildTaskPaths("20260425T222337", "verify", [
    "specification",
  ]);
  const ctx: TemplateContext = {
    ...paths,
    workDir,
    run_id: "20260425T222337",
    args: {},
    env: {},
  };

  const rendered = interpolate(
    "Spec: {{input.specification}}/01-spec.md",
    ctx,
  );

  assertEquals(rendered.includes(workDir), false);
  // No phase registry set up in this test, so flat path layout (no "plan/").
  assertEquals(
    rendered,
    "Spec: .flowai-workflow/runs/20260425T222337/specification/01-spec.md",
  );
});

Deno.test("workPath(ctx.workDir, ctx.node_dir) reconstructs the FS path the engine reads", () => {
  // Engine internal code (cwd = main repo) must wrap ctx.node_dir with
  // workPath(ctx.workDir, …) to land on the actual file. This invariant
  // pins that contract.
  const workDir = ".flowai-workflow/example/runs/20260425T222337/worktree";
  const paths = buildTaskPaths("20260425T222337", "verify");
  const ctx: TemplateContext = {
    ...paths,
    workDir,
    run_id: "20260425T222337",
    args: {},
    env: {},
  };

  assertEquals(
    workPath(ctx.workDir, ctx.node_dir),
    `${workDir}/.flowai-workflow/runs/20260425T222337/verify`,
  );
});

Deno.test("TemplateContext — workDir defaults to '.' is no-op for workPath", () => {
  const paths = buildTaskPaths("R", "n");
  const ctx: TemplateContext = {
    ...paths,
    workDir: ".",
    run_id: "R",
    args: {},
    env: {},
  };
  // Sanity: with workDir=".", workPath is identity; legacy semantics preserved.
  assertEquals(workPath(ctx.workDir, ctx.node_dir), ctx.node_dir);
});

// FR-E52: regression-guard against future consumers that introduce a bare
// `ctx.node_dir` / `ctx.run_dir` reference in engine-runtime code without
// wrapping it via `workPath(ctx.workDir, …)`. `template.ts` is the sole
// allowed raw-emission site (its outputs reach subprocess prompts whose cwd
// IS workDir, where the workDir-relative form correctly resolves).
Deno.test(
  "FR-E52 — bare ctx.node_dir / ctx.run_dir restricted to template.ts",
  async () => {
    const allowedRaw = new Set([
      "template.ts", // intentional raw emission for prompt interpolation
    ]);
    const offenders: string[] = [];

    for await (const path of walkTs(SRC_ROOT)) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (name.endsWith("_test.ts")) continue;
      if (allowedRaw.has(name)) continue;

      const content = await Deno.readTextFile(path);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments and JSDoc — they may legitimately mention the field.
        const trimmed = line.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        ) continue;

        if (/ctx\.(node_dir|run_dir)\b/.test(line)) {
          // Allowed when the same line wraps via workPath(<chain>.workDir, …).
          // Matches `workPath(ctx.workDir,` and `workPath(opts.ctx.workDir,`
          // alike — the relevant invariant is "wrap with a workDir-relative
          // root", not the exact identifier path the caller uses.
          if (/workPath\(\s*[\w.]*\bworkDir\b\s*,/.test(line)) continue;
          offenders.push(`${name}:${i + 1}: ${trimmed}`);
        }
      }
    }

    assertEquals(
      offenders,
      [],
      `FR-E52 violation — bare ctx.node_dir/run_dir found outside template.ts:\n${
        offenders.join("\n")
      }`,
    );
  },
);

// FR-E52: regression-guard for INDIRECT consumers — files that interpolate
// template paths (whose values ARE workDir-relative, see contract above) and
// then pass the result to filesystem operations. The first audit test only
// catches direct `ctx.node_dir` / `ctx.run_dir` references; it missed the
// validate.ts class of bug for over a release cycle because validate.ts
// pulled the path through `interpolate(rule.path, ctx)`. Issue #196 / run
// 20260501T020329 hit it: the loop's condition lookup (correctly wrapped)
// disagreed with validate.ts (silently un-wrapped) about where the QA report
// lived, and the loop failed even though QA passed.
//
// Invariant under test: a file that imports `interpolate` AND performs file
// I/O via `Deno.{stat,readTextFile,readDir,copyFile,writeTextFile}` MUST
// also import `workPath` (= caller has the wrap helper available — the next
// step is to actually USE it on FS-call paths). This is a coarse heuristic,
// not full data-flow analysis: it cannot prove the wrap is applied at every
// callsite, only that the file is "wrap-aware". The first audit test above
// catches the direct case; this one catches the indirect case at file
// granularity.
Deno.test(
  "FR-E52 — files that interpolate template paths AND do FS I/O must import workPath",
  async () => {
    // template.ts defines `interpolate` (no FS). Any other file using both
    // capabilities must declare it via the workPath import.
    const allowedNoWrap = new Set([
      "template.ts", // defines interpolate; emits strings, no FS I/O of its own
    ]);
    const offenders: string[] = [];

    const fsCallRegex =
      /\bDeno\.(stat|readTextFile|readDir|copyFile|writeTextFile|mkdir)\s*\(/;

    for await (const path of walkTs(SRC_ROOT)) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (name.endsWith("_test.ts")) continue;
      if (allowedNoWrap.has(name)) continue;

      const content = await Deno.readTextFile(path);
      // Match the `interpolate` import by module basename — the reorg into
      // src/<group>/ subfolders means the relative specifier may be
      // `./template.ts` or `../config/template.ts`.
      const usesInterpolate =
        /\bimport\s+\{[^}]*\binterpolate\b[^}]*\}\s+from\s+["'][^"']*\btemplate\.ts["']/
          .test(content);
      if (!usesInterpolate) continue;

      // Strip line/block comments so a comment mentioning `Deno.stat(` in
      // documentation prose does not falsely classify the file as an FS
      // consumer. Order matters: block comments first, then line comments.
      const codeOnly = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const doesFsIo = fsCallRegex.test(codeOnly);
      if (!doesFsIo) continue;

      const importsWorkPath =
        /\bimport\s+\{[^}]*\bworkPath\b[^}]*\}\s+from\s+["'][^"']*\bstate\.ts["']/
          .test(content);
      if (!importsWorkPath) {
        offenders.push(
          `${name}: imports interpolate + does Deno FS I/O but does not import workPath`,
        );
      }
    }

    assertEquals(
      offenders,
      [],
      `FR-E52 indirect-consumer violation:\n${offenders.join("\n")}`,
    );
  },
);
