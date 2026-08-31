import { assertEquals } from "@std/assert";
import { decideReleaseLevel, parseCommits } from "./release-level.ts";

const c = (subject: string, body = "") => ({ subject, body });

Deno.test("FR-E41 a feature asks for a minor bump before 1.0", () => {
  assertEquals(
    decideReleaseLevel([c("feat(engine): one scheduler")], "0.9.2"),
    "minor",
  );
});

Deno.test("FR-E41 a fix asks for a patch bump", () => {
  assertEquals(
    decideReleaseLevel([c("fix(engine): stop sending")], "0.9.2"),
    "patch",
  );
});

Deno.test("FR-E41 project-style and other patch types ask for a patch bump", () => {
  for (
    const subject of [
      "engine: drop the second scheduler",
      "perf(engine): cache the graph",
      "refactor(state): split the journal",
      "build: pin the compiler",
    ]
  ) {
    assertEquals(decideReleaseLevel([c(subject)], "0.9.2"), "patch", subject);
  }
});

Deno.test("FR-E41 housekeeping types release nothing", () => {
  for (
    const subject of [
      "chore(deps): raise the ai-ide-cli pin",
      "docs: correct two task-file rules",
      "ci: use an explicit bump level",
      "test(engine): cover the outcome wave",
      "sdlc: retune the reviewer prompt",
      "Merge pull request #245 from korchasa/engine/one-scheduler",
    ]
  ) {
    assertEquals(decideReleaseLevel([c(subject)], "0.9.2"), "none", subject);
  }
});

Deno.test("FR-E41 an empty range releases nothing", () => {
  assertEquals(decideReleaseLevel([], "0.9.2"), "none");
});

Deno.test("FR-E41 a breaking change is minor before 1.0 and major after", () => {
  const bang = [c("feat(engine)!: replace for_each with fork/join")];
  assertEquals(decideReleaseLevel(bang, "0.9.2"), "minor");
  assertEquals(decideReleaseLevel(bang, "1.4.0"), "major");

  const footer = [
    c(
      "feat(engine): replace for_each",
      "BREAKING CHANGE: for_each is rejected",
    ),
  ];
  assertEquals(decideReleaseLevel(footer, "0.9.2"), "minor");
  assertEquals(decideReleaseLevel(footer, "1.4.0"), "major");
});

Deno.test("FR-E41 a feature stays minor after 1.0", () => {
  assertEquals(
    decideReleaseLevel([c("feat(engine): one scheduler")], "1.4.0"),
    "minor",
  );
});

Deno.test("FR-E41 the strongest commit in the range wins", () => {
  const commits = [
    c("Merge pull request #245 from korchasa/engine/one-scheduler"),
    c("chore(deps): raise the ai-ide-cli pin"),
    c("fix(engine): stop sending ACP-unsupported options"),
    c("feat(engine): one scheduler"),
  ];
  assertEquals(decideReleaseLevel(commits, "0.9.2"), "minor");
});

Deno.test("FR-E41 a merge subject never hides the branch commits", () => {
  // The regression that shipped FR-E99 as a patch: the merge commit is
  // typeless, so the level must come from every commit in the range.
  const commits = [
    c("Merge pull request #245 from korchasa/engine/one-scheduler-run-outcome"),
    c("chore(deps): raise the ai-ide-cli pin to 0.8.13"),
    c("feat(engine): one scheduler and the run outcome as a value (FR-E99)"),
  ];
  assertEquals(decideReleaseLevel(commits, "0.9.1"), "minor");
});

Deno.test("FR-E41 git log records split into subject and body", () => {
  const raw = [
    "feat(engine): one scheduler\x00\x1e",
    "feat(engine)!: fork/join\x00BREAKING CHANGE: for_each is rejected\n\x1e",
  ].join("");
  const commits = parseCommits(raw);
  assertEquals(commits.length, 2);
  assertEquals(commits[0].subject, "feat(engine): one scheduler");
  assertEquals(commits[0].body, "");
  assertEquals(commits[1].subject, "feat(engine)!: fork/join");
  assertEquals(commits[1].body, "BREAKING CHANGE: for_each is rejected");
});

Deno.test("FR-E41 a scoped type with a bang is read as breaking", () => {
  assertEquals(
    decideReleaseLevel([c("fix!: drop the legacy flag")], "1.0.0"),
    "major",
  );
  assertEquals(
    decideReleaseLevel([c("fix!: drop the legacy flag")], "0.9.2"),
    "minor",
  );
});
