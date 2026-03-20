## Summary

### Files Changed

- `engine/template.ts` — added `validateTemplateVars(template, knownInputs)` exported function; pure validation counterpart to `resolve()`; validates all `{{...}}` patterns against known prefixes (`input`, `env`, `args`, `loop`) and direct keys (`node_dir`, `run_dir`, `run_id`); accepts `file("...")` pattern; accumulates and returns all errors
- `engine/config.ts` — added `import { validateTemplateVars } from "./template.ts"`; added hook validation block in `validateNode()` for `node.before` and `node.after` fields; loop body nodes automatically inherit the combined `[...allNodeIds, ...bodyNodeIds]` context via the existing `validInputIds` passed to recursive `validateNode()` calls
- `engine/template_test.ts` — added 12 unit tests for `validateTemplateVars` covering: empty string, no placeholders, valid direct keys, valid input with known node, input with unknown node, env/args valid, loop.iteration valid, unknown loop property, file() pattern, unknown prefix, unknown direct key, multiple errors accumulated
- `engine/config_test.ts` — added 8 integration tests for hook validation via `parseConfig`: valid before/after hooks pass, unknown prefix in before/after throws with node ID and hook type in message, valid `input.<node-id>` from same pipeline passes, `input.<unknown>` in hook throws, loop body node hook with body-sibling reference passes

### Tests Added or Modified

- `engine/template_test.ts`: 12 new tests
- `engine/config_test.ts`: 8 new tests
- Total: 569 tests (up from 549)

### `deno task check` Result

PASS
