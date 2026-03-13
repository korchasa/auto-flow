---
variant: "Variant B"
tasks:
  - desc: "Add phases top-level key to pipeline.yaml"
    files: [".sdlc/pipeline.yaml"]
  - desc: "Rename all node IDs to activity-based names in pipeline.yaml"
    files: [".sdlc/pipeline.yaml"]
  - desc: "Update SKILL.md template references to activity-based IDs"
    files:
      - "agents/architect/SKILL.md"
      - "agents/tech-lead/SKILL.md"
      - "agents/executor/SKILL.md"
      - "agents/qa/SKILL.md"
      - "agents/tech-lead-review/SKILL.md"
  - desc: "Update README pipeline documentation"
    files: ["README.md"]
---

## Justification

I selected Variant B (two-phase approach) over A (all-at-once) and C (minimal).

**Why not Variant A:** The spec defines two distinct sub-concerns — phase
grouping and stage naming. Variant A conflates them into one atomic change,
making it harder to isolate failures. The rename touches every `inputs:`,
`{{input.*}}`, and `condition_node` reference — coupling that with a new
top-level key addition increases review complexity unnecessarily.

**Why not Variant C:** SKILL.md files are agent system prompts — stale
`{{input.pm}}` examples would confuse agents about available template variables.
In an AI-agent system, prompts are functional code, not passive documentation.
Skipping SKILL.md updates creates a latent failure mode.

**Why Variant B:** Separates the purely additive change (phases key) from the
breaking change (ID rename). Each commit is independently valid. The phases key
commit can be validated before the rename commit. Maps cleanly to the spec's two
sub-concerns. Same final outcome as Variant A with lower risk.

**Vision alignment:** Activity-based naming makes pipeline configs
self-documenting, supporting the project goal of pipeline-agnostic design.
Phases as first-class config enable future phase-level `run_on` semantics and
cleaner artifact layout (FR-23).

## Task Descriptions

### Task 1: Add phases top-level key to pipeline.yaml

Add a `phases:` top-level key after `defaults:`, before `nodes:`. Each phase
lists its member stage IDs using current (role-based) names. Three phases:
- `plan`: [pm, architect, tech-lead]
- `impl`: [impl-loop]
- `report`: [tech-lead-review, meta-agent]

Purely additive — no existing config modified. Engine ignores unknown top-level
keys, so this is safe.

### Task 2: Rename all node IDs to activity-based names

Apply the ID mapping from the plan:
- `pm` → `specification`
- `architect` → `design`
- `tech-lead` → `decision`
- `impl-loop` → `implementation`
- `executor` → `build`
- `qa` → `verify`
- `tech-lead-review` → `review`
- `meta-agent` → `optimize`

Update all cross-references in pipeline.yaml:
- Node keys
- `inputs:` arrays
- `{{input.*}}` in `task_template` fields
- `condition_node: qa` → `condition_node: verify`
- `defaults.hitl.issue_source: plan/pm/01-spec.md` → `plan/specification/01-spec.md`
- Phase member lists (from task 1)

### Task 3: Update SKILL.md template references

Update `{{input.*}}` example references in 5 SKILL.md files:
- `agents/architect/SKILL.md`: `{{input.pm}}` → `{{input.specification}}`
- `agents/tech-lead/SKILL.md`: `{{input.pm}}` → `{{input.specification}}`,
  `{{input.architect}}` → `{{input.design}}`
- `agents/executor/SKILL.md`: `{{input.tech-lead}}` → `{{input.decision}}`
- `agents/qa/SKILL.md`: `{{input.pm}}` → `{{input.specification}}`,
  `{{input.tech-lead}}` → `{{input.decision}}`
- `agents/tech-lead-review/SKILL.md`: `{{input.pm}}` → `{{input.specification}}`,
  `{{input.tech-lead}}` → `{{input.decision}}`

### Task 4: Update README pipeline documentation

Update pipeline table and any node-ID references in README.md to use
activity-based names.
