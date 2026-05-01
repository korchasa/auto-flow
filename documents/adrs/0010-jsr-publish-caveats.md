# ADR-0010: JSR publish surface — `.versionrc.json`, `publish.exclude`, `--dry-run` verification

## Status

Accepted

## Context

Publishing `@korchasa/flowai-workflow` to JSR is the supported
distribution channel (alongside the standalone binaries from FR-E39).
The publish surface has three independent failure modes that bit the
project once each before being codified:

- **Version drift.** CI invokes `npm:standard-version` to bump
  versions and update `CHANGELOG.md`. `standard-version` defaults to
  reading/writing `package.json`, but Deno projects don't have one.
  Without a `.versionrc.json` at repo root that declares
  `packageFiles` and `bumpFiles` pointing at `deno.json`, the tool
  silently produces "release" commits that update `CHANGELOG.md`
  without bumping `deno.json#version`, leaving the repo in a state
  where the published JSR version and the source's stated version
  diverge.
- **Tarball bloat / leak.** `publish.exclude` controls what ships in
  the JSR tarball. `documents/`, `scripts/`, `.github/`, `.claude/`,
  `.devcontainer/`, `AGENTS.md`, `CHANGELOG.md`, and `.versionrc.json`
  are dev-only; bundled `.flowai-workflow/<name>/runs/`,
  `.flowai-workflow/<name>/memory/agent-*.md`, and
  `.flowai-workflow/<name>/.template.json` are per-run dirt that
  must never reach a client install. The included list is positive
  ("ship runtime source + bundled workflows used by `init`"), the
  excluded list is negative — both are load-bearing.
- **Slow-types lint blind spot.** JSR's `no-slow-types`,
  `missing-jsdoc`, and `private-type-ref` rules fire ONLY on
  `deno publish --dry-run`, never on `deno check` or `deno lint`.
  `deno doc --lint <entry>` only walks symbols reachable from the
  given entry — barrel-bypassed exports go unchecked. A clean local
  `deno check` does NOT mean a clean publish.

## Decision

Codify all three contracts in the project, lint-or-CI-enforced where
possible:

- **`.versionrc.json` is mandatory** at repo root and MUST declare
  `packageFiles: [{ filename: "deno.json", type: "json" }]` and
  `bumpFiles: [{ filename: "deno.json", type: "json" }]`. When
  cloning the CI skeleton to a new repo, copy `.versionrc.json` and
  `deno.json` together — they are a unit.
- **`deno.json#publish.include` and `publish.exclude`** keep dev
  paths out of the tarball and per-run dirt out of the bundled
  workflow folders. Verify after touching either list with
  `deno publish --dry-run`. The file list should mention only
  runtime source, `deno.json`, `README.md`, and the workflow's
  tracked `.gitignore`, `workflow.yaml`, `agents/`, `scripts/`,
  `memory/reflection-protocol.md`. `publish.include` MUST NOT
  reference paths outside the package directory (`../README.md` is
  rejected with `error[invalid-path]`).
- **`deno task check` runs `deno publish --dry-run --allow-dirty`**
  as its final step (`scripts/check.ts` lines 570–574) so JSR
  slow-types failures surface locally before commit, not on the
  release CI run.

## Consequences

- **Positive.** Three classes of release-time-only failures all fail
  fast at `deno task check`. New contributors don't need to
  rediscover the caveats by tripping over them. Memory invalidation
  and tarball auditing have a single reference point.
- **Negative.** `deno publish --dry-run` adds wallclock time to every
  local check (cost ~5–10 s). `.versionrc.json` is a CI-skeleton
  artefact that looks superfluous on a casual read of the tree.
- **Invariants.** `scripts/check.ts` MUST keep `deno publish --dry-run
  --allow-dirty` as a step. `.versionrc.json` MUST stay at repo root
  with the documented field set. `publish.exclude` MUST include the
  per-run dirt patterns inside `.flowai-workflow/<name>/`.
- **Cross-link.** AGENTS.md "Repo Layout" section enumerates the
  publish-side gotchas in narrative form; this ADR is the canonical
  rationale.

## Alternatives Considered

- **Drop standard-version; bump `deno.json#version` by hand in
  release PRs.** Rejected — manual step, easy to forget, and the
  CHANGELOG generation depends on the same tool. Configuring it
  once is cheaper than coordinating the manual step forever.
- **Skip `--dry-run` locally; rely on the release CI to catch
  slow-types failures.** Rejected — CI failures on the release
  workflow are loud, expensive, and break the version-tag → release
  pipeline. Catching the same errors at `deno task check` keeps the
  feedback loop in seconds.
- **Move dev-only paths under a `dev/` subtree so they auto-exclude
  by default.** Rejected — would force a large repo reshuffle for
  cosmetic gain; the explicit `publish.exclude` list is auditable
  and short.
