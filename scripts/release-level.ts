/**
 * Decide the semver bump level for a range of commits.
 *
 * CI used to hand the decision to `commit-and-tag-version`, which applies
 * pre-1.0 semantics of its own: while the version is `0.x`, a `feat` commit
 * bumps only the PATCH digit and a breaking change bumps the MINOR one. That
 * shipped FR-E99 — a feature — as 0.9.2. The level is now computed here and
 * passed to the tool as an explicit `--release-as`, so the released number
 * follows one rule set that lives in the repository and is covered by tests.
 *
 * Usage: `deno run -A scripts/release-level.ts [<git-range>]`
 * Prints one of `none`, `patch`, `minor`, `major`.
 */

/** Bump level, ordered from weakest to strongest by {@link RANK}. */
export type ReleaseLevel = "none" | "patch" | "minor" | "major";

/** One commit reduced to the two parts the decision reads. */
export interface CommitRecord {
  subject: string;
  body: string;
}

const RANK: Record<ReleaseLevel, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/** Types that add capability. */
const MINOR_TYPES = new Set(["feat"]);

/**
 * Types that ship a correction. `engine` and `engine+sdlc` are the project's
 * own prefixes (see AGENTS.md, GitHub Issue Rules); `sdlc` is deliberately
 * absent because workflow changes are dev tooling and release nothing.
 */
const PATCH_TYPES = new Set([
  "fix",
  "perf",
  "refactor",
  "build",
  "engine",
  "engine+sdlc",
]);

/** `type(scope)!: subject` — the bang is the inline breaking marker. */
const HEADER = /^(?<type>[a-z+]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s/;

const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/**
 * Split the output of `git log --format=%s%x00%b%x1e` into records.
 *
 * The separators are control characters rather than newlines because a
 * commit body carries newlines of its own.
 */
export function parseCommits(raw: string): CommitRecord[] {
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [subject, ...rest] = record.split("\x00");
      return { subject: subject.trim(), body: rest.join("\x00").trim() };
    });
}

/** Level a single commit asks for, before the pre-1.0 rule is applied. */
function levelOf(
  commit: CommitRecord,
  breakingLevel: ReleaseLevel,
): ReleaseLevel {
  const header = HEADER.exec(commit.subject);
  if (!header?.groups) return "none";

  const breaking = header.groups.bang === "!" ||
    BREAKING_FOOTER.test(commit.body);
  if (breaking) return breakingLevel;

  const type = header.groups.type;
  if (MINOR_TYPES.has(type)) return "minor";
  if (PATCH_TYPES.has(type)) return "patch";
  return "none";
}

/**
 * Strongest level any commit in the range asks for.
 *
 * A merge commit has no conventional-commit header, so it contributes
 * nothing — the level comes from the commits the merge brought in, which is
 * why the range must list them all rather than first parents only.
 *
 * While `currentVersion` is `0.x` a breaking change is capped at MINOR: the
 * public API is still declared unstable, and 1.0.0 is a decision to make
 * deliberately rather than a side effect of one commit.
 */
export function decideReleaseLevel(
  commits: CommitRecord[],
  currentVersion: string,
): ReleaseLevel {
  const major = Number.parseInt(currentVersion.split(".")[0], 10);
  if (!Number.isFinite(major)) {
    throw new Error(`Cannot read a major version from "${currentVersion}"`);
  }
  const breakingLevel: ReleaseLevel = major === 0 ? "minor" : "major";

  let level: ReleaseLevel = "none";
  for (const commit of commits) {
    const candidate = levelOf(commit, breakingLevel);
    if (RANK[candidate] > RANK[level]) level = candidate;
  }
  return level;
}

/** Read the commits of `range` (whole history when it is empty). */
async function readCommits(range: string): Promise<CommitRecord[]> {
  const args = ["log", "--format=%s%x00%b%x1e"];
  if (range) args.push(range);
  const { code, stdout, stderr } = await new Deno.Command("git", { args })
    .output();
  if (code !== 0) {
    throw new Error(`git log failed: ${new TextDecoder().decode(stderr)}`);
  }
  return parseCommits(new TextDecoder().decode(stdout));
}

/** Version currently declared in `deno.json`. */
async function readVersion(): Promise<string> {
  const text = await Deno.readTextFile(
    new URL("../deno.json", import.meta.url),
  );
  const { version } = JSON.parse(text) as { version?: string };
  if (!version) throw new Error("deno.json has no version field");
  return version;
}

if (import.meta.main) {
  const range = Deno.args[0] ?? "";
  const level = decideReleaseLevel(
    await readCommits(range),
    await readVersion(),
  );
  console.log(level);
}
