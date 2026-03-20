# Pipeline Structure Review

## 2. Artifact numbering inconsistency

- 01-spec -> 02-plan -> 03-decision -> 04-impl-summary -> 05-qa-report -> 06-review
- Missing: 03, 07. Numbers 05/06 reversed (build=06, verify=05)

## 3. Phases — double definition

`phases` section (lines 29-31) groups nodes, but each node also has `phase:` field.
One of these is redundant.

## 4. hitl.artifact_source in defaults

`artifact_source: plan/specification/01-spec.md` — hardcoded reference to specific node
in a block meant to be generic.

## 5. Two error handling mechanisms

- Global `on_failure_script` in defaults
- Per-node `settings.on_error: continue` in tech-lead-review
- Interaction unclear. Potential conflict.

## 6. Implicit input forwarding in loop

`build` references `[decision]` — a node **outside** the loop.
Works via loop's `inputs` forwarding, but this is implicit.
`verify` mixes external and internal loop nodes in its inputs.

## 7. Model override without justification

`design` and `decision` override model to opus. Other 4 nodes use default sonnet.
No comment explaining the rationale.

## 8. Silent error suppression in tech-lead-review

`after: "... || true"` + `settings.on_error: continue` + `run_on: always` —
if dashboard fails, no one will know.

## 9. Missing verdict validation in loop

Loop checks `condition_field: verdict` from verify node, but verify's `validate`
block does not include `frontmatter_field: verdict`. If agent omits verdict,
loop fails without clear error. Should add:
```yaml
- type: frontmatter_field
  path: "{{node_dir}}/05-qa-report.md"
  field: verdict
```

## Summary

Main issues: massive validation duplication (solvable via defaults/preset),
double phase definition, inconsistent artifact numbering.
Pipeline is readable but duplication will grow with more nodes.
