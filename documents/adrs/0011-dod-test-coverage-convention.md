# ADR-0011: DoD acceptance items covered by regression tests collapse to a Tests pointer

## Status

Accepted

## Context

Acceptance-criteria blocks in SRS files (`requirements-engine/*.md`,
`requirements-sdlc/*.md`) currently list every implementation
detail as a separate `[x] Criterion. Evidence: <files>` line. After
several FR cycles the lists balloon — FR-E47 has 11 `[x]` lines,
FR-E50 has 9, FR-E57 has 7 — and the same pattern repeats across
dozens of FRs.

The bloat creates two real costs:

- **Future-session noise.** A new agent (or human) opening an FR
  reads ten lines that all say, in effect, "tests cover this; here
  is the test file". The signal — what the FR REQUIRES — is buried
  under the receipts.
- **False sense of "things to verify".** When DoD lists ten checked
  items, an honest review tries to spot-check each one. Most of
  them are regression-locked by named tests in `*_test.ts` — the
  agent doesn't need to verify anything; CI does. The verification
  ritual is wasted work.

The shared insight: a `[x]` item whose ONLY contract is "this test
asserts the behaviour" duplicates the test's existence in plain
prose. Removing the prose doesn't drop coverage — the test still
runs on every `deno task check`.

## Decision

Adopt the following convention for FR acceptance blocks across SRS
files (engine and SDLC):

- **Behaviour locked by a regression test** — collapse to a single
  per-FR line at the top of the acceptance block. Format:

  ```markdown
  - **Tests:** `<test_file>` (FR-E<N>; regression-locked). See ADR-NNNN.
  ```

  Rules:
  - List **test files only**, comma-separated. No test names.
    The reader navigates with `grep "FR-E<N>" <test_file>` — the
    project convention already embeds the FR id in the test name
    (e.g. `(FR-E57)` in `worktree_test.ts`), so the file + grep
    anchor is sufficient.
  - The `(FR-E<N>; regression-locked)` parenthetical is the grep
    anchor + status. Drop `(FR-E<N>; …)` only when the FR id has
    no embedded test names — then state where the assertions live
    in 3-5 words (e.g. `(regression-locked; verbose toggle)`).
  - `See ADR-NNNN.` is appended ONLY when an ADR records the
    rationale. Omit otherwise — the FR's `**Description:**` already
    carries the why for non-ADR'd FRs.
  - Per-criterion `[x]` bullets exercised by the listed tests are
    removed. CI catches regressions; the agent doesn't re-verify.

- **Behaviour requiring manual verification** — keep as a `[x]`
  bullet with `Evidence: <source-path>:<line>` exactly as today.
  Examples: prose docs in README/AGENTS.md, generated artefacts,
  one-time migrations, CLI smoke output, behaviours not yet
  covered by a test.

- **`deno task check passes`** — drop entirely. `deno task check` is
  the project's universal CI gate (per `documents/CLAUDE.md`); the
  per-FR `[x] deno task check passes` line carries no information
  beyond "we ran CI", which every commit already does.

The audit that decides whether an item is "regression-locked" greps
the listed test file for the FR id (or, when no FR-tagged tests
exist, reads the relevant tests by name) and confirms assertions
actually exercise the behaviour. A test mentioned in `Evidence:`
but unrelated to the claim is NOT a regression lock — the item
stays as `[x]`.

> **Note (same-session refinement, pre-application).** The
> initial Decision block of this ADR enumerated test names inside
> `**Tests:**`. During application to the first FR (FR-E53) the
> verbosity proved counter-productive: 6 test names occupied as
> much space as the original `[x]` bullets. The format was tightened
> to file-list + grep anchor before any FR migration shipped. No
> superseding ADR was issued because the policy had not yet been
> instantiated. Future format changes after FR migration begins
> MUST follow the supersede-via-new-ADR rule.

## Consequences

- **Positive.** Per-FR acceptance blocks shrink from 5–15 lines to
  1 (Tests) + 0–3 (manual). Future readers see the FR's actual
  requirements, not a rehash of test discovery. ADR cross-link
  carries the "why" so the rationale isn't repeated per FR.
- **Negative.** A test renamed without updating the `**Tests:**`
  pointer becomes a stale reference (same risk that `Evidence:`
  pointers already carry). Audit during the rename keeps it
  honest — no new mechanism. The collapse loses the granular
  per-criterion checkbox vibe; reviewers who used to scan the box
  list now read prose.
- **Invariants.** New FRs MUST follow the convention — `[x]` is for
  manual-verification items only. The `**Tests:**` line MUST
  reference test names that exist in the repo. Acceptance blocks
  MUST NOT include `[x] deno task check passes`.
- **Cross-link.** Codified in
  [documents/CLAUDE.md](../CLAUDE.md) §Acceptance criteria.

## Alternatives Considered

- **Keep listing every test-covered item as `[x]`.** Rejected — the
  bloat is the problem; preserving it preserves the cost.
- **Drop the `**Tests:**` pointer entirely (assume readers will
  grep).** Rejected — the pointer is a 1-line index that survives
  test-file moves with one find-replace; grepping costs more for
  every reader forever.
- **Collapse to a count (`Tests: 8 covering …`).** Rejected — a
  numeric count without names is unfalsifiable; a future test
  removal silently turns 8 into 7 with no signal. Names give the
  reviewer something to verify.
- **Auto-generate the `**Tests:**` line from a sidecar map.**
  Rejected for now — adds tooling overhead for what is a manual
  audit (test↔FR mapping) anyway. Revisit if the manual approach
  rots.
