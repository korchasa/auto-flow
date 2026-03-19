## Summary

### Files Changed

- `engine/config.ts` — added loop input forwarding validation (FR-E35) in
  `validateNode()` loop branch, after the existing body node validation loop.
  For each body node, any `inputs` entry not in `bodyNodeIds` (external) is
  checked against the enclosing loop node's `inputs`. Missing entries throw a
  config error naming the loop, body node, and missing input IDs.
- `.auto-flow/pipeline.yaml` — added `specification` to the `implementation`
  loop node's `inputs` (was `[decision]`, now `[specification, decision]`).
  The `verify` body node references `{{input.specification}}`, so the loop
  must forward it. The new validation correctly caught this pre-existing gap.

### Tests Added

`engine/config_test.ts` — 4 new test cases (FR-E35 group):

1. `parseConfig — loop forwarding: body node references external input in loop.inputs → passes`
2. `parseConfig — loop forwarding: body node references external input NOT in loop.inputs → throws`
3. `parseConfig — loop forwarding: body node references sibling body node → no error`
4. `parseConfig — loop forwarding: body node with no inputs → no error`

### Check Status

`deno task check` — PASS (528 tests, 0 failed, all lints clean)
