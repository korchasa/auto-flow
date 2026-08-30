# Engine SRS: Development Visualization

### 3.94 FR-E94: Static Workflow Diagram

- **Description:** A development script MUST read either a workflow directory
  or its `workflow.yaml` and emit one self-contained interactive HTML canvas
  when the output path ends in `.html`. The canvas MUST resemble a visual
  workflow editor: all nodes and edges share one pannable and zoomable SVG,
  node cards expose their operation and phase, and selecting a node opens its
  complete configuration in an inspector. Unassigned nodes MUST be placed in a
  phase inferred from adjacent dependencies when unambiguous and reported as
  warnings; unresolved nodes remain in `other`. Post-workflow nodes MUST have
  their own group in the Mermaid view and MUST be marked as such on every card
  of the canvas. Loop body nodes and their internal dependencies MUST remain
  visible in BOTH views: a loop body is declared inside its loop node and never
  appears in `nodes`, so a canvas built from that map alone hides a workflow's
  whole inner cycle behind one card. The reader accepts both the string and the
  object form of `fork` (FR-E95), because visualization must work across
  project-local engine versions without executing the workflow.
  Every card MUST expose its prerequisite ports, operation kind, phase, and a
  concise command or agent-instruction summary. The inspector MUST retain the
  exact command, full prompt, `when`, `before`, `after`, validation, fork and
  join membership, loop exit, post-workflow condition, and node overrides. A
  schema-aware coverage audit MUST mark the output incomplete and name every
  unrecognized workflow, default, node, setting, fork, or validation field
  instead of silently omitting it.

  **Invocation.** `deno task workflow-diagram -- <workflow-dir-or-yaml>
  --output <file.html>` writes the self-contained HTML fragment. A non-`.html`
  output path, or none at all, writes the Markdown/Mermaid document to that
  file or to standard output.
- **Acceptance criteria:**
  - **Tests:** `scripts/workflow-diagram_test.ts` (FR-E94;
    regression-locked; directory and direct-file input resolution, a missing
    input path rejected, phase grouping and node traits, the schema-coverage
    audit naming unrepresented fields, transitive-edge reduction, both `fork`
    shapes, loop bodies and their internal edges in the Mermaid view and on
    the HTML canvas, and one self-contained SVG canvas with no external
    resources).
  - [ ] Pan, zoom, fit and node selection are asserted as behaviour rather
    than by the presence of their DOM attributes — the inline script is only
    parsed by the current test, never executed, because Deno's test runner has
    no DOM.
