## Summary

Implementation was already committed in a prior session (commits `109d652` + `b0bd0fb`).
Pre-flight check detected `sdlc(impl):` prefix → skipped re-implementation.

### Files Changed

- `engine/cli.ts` — added `VERSION` constant (`Deno.env.get("VERSION") ?? "dev"`),
  `getVersionString()` export, and `--version`/`-V` flag handling (exits after print)
- `scripts/compile.ts` — new Deno script: 4-target cross-compile via `deno compile --env-file`;
  writes temp env file, iterates targets, outputs to `dist/`, supports `--dry-run`
- `scripts/compile_test.ts` — unit tests for target list, filename convention, target mapping,
  dry-run mode; VERSION type + getVersionString format tests
- `.github/workflows/release.yml` — release CI workflow triggered on `v*` tag; runs compile
  script → `gh release create` with auto-generated notes; single `ubuntu-latest` job
- `README.md` — added "Installation" section: binary download via GitHub Releases, chmod+x,
  usage example, platform detection hint, Deno source install as alternative
- `deno.json` — added `"compile": "deno run --allow-all scripts/compile.ts"` task

### Tests Added / Modified

- `scripts/compile_test.ts` (new) — 2 tests: target list coverage (4 targets) + filename
  convention (`auto-flow-<os>-<arch>` format); VERSION type check + getVersionString() format
- `engine/cli_test.ts` (modified) — tests for `getVersionString()` export and VERSION constant
  type validation

### Check Result

PASS — 578 tests pass, 0 failed. All checks passed.
