<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Engine Modules (types, template, config, dag, validate, state, runtime, agent)


## 3. Components

### 3.1 Workflow Engine (`engine/`)

- **Purpose:** Configurable DAG-based workflow executor. Replaces hardcoded
  shell script orchestration with YAML-driven node graph.
- **Modules:**
  - `types.ts` — type declarations (incl. `ValidationRule.type` union
    (`"artifact"` added — FR-E33: composite rule with `sections?: string[]`;
    `"scope_check"` added — FR-E37: internal-only, engine auto-injects when
    `allowed_paths` present, not user-configured in YAML),
    `NodeConfig.allowed_paths` (`string[]`, optional — FR-E37: glob patterns
    defining allowed file modifications for scope-based detection),
    `NodeConfig.run_on` (`"always"|"success"|"failure"`), `NodeConfig.phase`,
    `NodeConfig.env`, `NodeConfig.model` (per-node runtime model override),
    `NodeConfig.runtime`, `NodeConfig.runtime_args`,
    `WorkflowDefaults.model` (default model for all nodes),
    `WorkflowDefaults.runtime`, `WorkflowDefaults.runtime_args`,
    `LoopNodeConfig.nodes` (inline body node definitions),
    `LoopResult.bodyResults`, `ErrorCategory` (structured failure enum),
    `NodeState.error_category`, `NodeState.cost_usd` (FR-E17 per-node cost),
    `RunState.total_cost_usd` (FR-E17 aggregated run cost),
    `WorkflowDefaults.on_failure_script` (FR-E19 configurable failure hook),
    `WorkflowDefaults.prepare_command` (FR-E30 post-config/pre-node shell hook),
    `HitlConfig.artifact_source` (renamed from `issue_source`),
    `HitlConfig.exclude_login` (renamed from `bot_login`),
    `Verbosity` union: `"quiet"|"normal"|"semi-verbose"|"verbose"` (FR-E21))
  - `template.ts` — `{{var}}` interpolation for prompts/paths.
    `resolve()` handles `file("path")` pattern within `{{...}}` matches
    (FR-E32): detects `/^file\("(.+)"\)$/`, reads file via
    `Deno.readTextFileSync()` relative to `Deno.cwd()`, returns content
    as-is (no re-interpolation — single-pass). Missing file → throw with
    diagnostic. Size > `FILE_INCLUSION_SIZE_WARN_BYTES` (100KB) →
    `console.warn()` (non-fatal).
    `validateTemplateVars(template: string, knownInputs: string[]): string[]`
    (FR-E7): extracts all `{{...}}` patterns, validates each against known
    prefixes (`input` — suffix ∈ `knownInputs`, `env`, `args`, `loop` —
    only `loop.iteration`) and direct keys (`run_dir`, `run_id`, `node_dir`).
    `file("...")` accepted. Unknown prefix/key → error string. Returns error
    array (empty = valid). Pure function, no I/O. Co-located with `resolve()`
    to maintain single source of truth for valid template variables
  - `config.ts` — YAML parsing, schema validation, defaults merge,
    `run_on` normalization. `extractWorktreeDisabled()`: lightweight pre-parse
    extracting only `defaults.worktree_disabled` for two-phase loading (FR-E24). `validateNode()`: if `run_on` present, must be
    one of `"always"|"success"|"failure"`; error:
    `Node '<id>' has invalid run_on value '<val>'. Must be one of: always, success, failure`.
    `validateFileReferences(config)` (FR-E32): scans all `task_template`
    and `prompt` fields (incl. loop body nodes) for `{{file("...")}}` regex,
    checks file existence via `Deno.statSync()`. Skips paths containing `{{`
    (unresolvable at load time). Called from `mergeDefaults()` alongside
    `validatePromptPaths()`.
    **Hook template variable validation (FR-E7):** In `validateNode()`, after
    existing type-specific checks: calls `validateTemplateVars()` (imported
    from `template.ts`) on `node.before` and `node.after` strings. Passes
    `allNodeIds` as `knownInputs` (for top-level nodes) or
    `[...allNodeIds, ...bodyNodeIds]` (for loop body nodes — can reference
    both external and sibling nodes). Errors formatted with hook type
    (`before`/`after`) and node ID. Non-empty errors → config validation
    error at load time (fail-fast).
    `validateAllowedPaths()` (FR-E37): when `allowed_paths` present on node,
    validates array of non-empty strings. Invalid → config error at parse time.
    Called from `validateNode()`.
    `validateValidationRule()` (FR-E33, FR-E38): `"artifact"` added to
    `validTypes`. When `type === "artifact"`: at least one of `sections` or
    `fields` required (both optional individually). `sections` validated as
    non-empty string array when present. `fields` validated as non-empty
    string array (no empty strings) when present. Missing both → config error.
    Invalid entries → config error at parse time.
    **Phase mutual-exclusivity validation (FR-E33):** After existing `phases:`
    block structure validation (~line 128), new pass iterates all nodes checking
    for `phase:` field while `config.phases` is defined. If both mechanisms
    detected: throws diagnostic error naming both mechanisms and ≥1 affected
    node ID. Format: `"Config uses both 'phases' block and per-node 'phase'
    field (node '<id>'). Use one mechanism only."`. Runs in `mergeDefaults()`
    alongside existing validation passes.
    `normalizeRunOn()` pass (in `mergeDefaults()`):
    if `node.run_always === true && !node.run_on` → sets `run_on = "always"`;
    if both present, `run_on` wins; deletes `run_always` from config
    post-normalization (downstream code only sees `run_on`).
    Loop nodes: parses `nodes` sub-object, validates body node ordering
    (>1 entry requires `inputs` declarations), validates `condition_node`
    references valid key in `nodes`. Skips top-level existence check for
    body node IDs referenced in `inputs`.
    **Loop input forwarding validation (FR-E35):** After body node validation
    loop (~line 261-271), iterates each body node's `inputs`. For each input
    NOT in `bodyNodeIds` (external reference), checks presence in
    `node.inputs ?? []` (loop node's declared inputs). Missing → throws:
    `"Loop '<loopId>' body node '<bodyId>' references external input(s)
    [<missing>] not listed in loop inputs"`. Runs inline in `validateNode()`
    loop branch — no new function or signature change. `node.inputs` accessed
    directly from the loop node object already in scope.
    **Loop condition_field validation (FR-E36):** After FR-E35 input forwarding
    check, inspects condition node's `validate` array for a `frontmatter_field`
    rule whose `field` matches `condition_field`. If condition node HAS a
    `validate` block but NO matching `frontmatter_field` rule → throws:
    `"Loop '<id>' condition_field '<field>' is not declared as a
    frontmatter_field in condition node '<condId>' validate block"`. If
    condition node has no `validate` block at all → skip (no contract to
    enforce). Inline in `validateNode()` loop branch — consistent with FR-E35
    pattern. No new function or signature change.
  - `dag.ts` — topological sort, cycle detection, level grouping.
    Excludes loop body nodes (from `nodes` sub-object) from top-level
    graph; loop node itself remains in DAG with its declared `inputs`.
  - `validate.ts` — artifact validation rules (file_exists, not_empty,
    contains_section, custom_script, frontmatter_field, artifact).
    `checkArtifact(path, sections, fields)` (FR-E33, FR-E38): self-contained
    private function. Stat → read → heading-regex loop → field-presence check
    → aggregate. Fail-fast order: absent file → empty file → missing sections
    → missing/empty fields. All missing sections collected into one aggregate
    `ValidationResult`. Heading regex duplicated from `checkContainsSection()`
    (~1 line) — intentional. Frontmatter field presence: parse frontmatter via
    `^---\n([\s\S]*?)\n---` regex (same approach as `checkFrontmatterField`),
    extract key-value pairs, check each `fields` entry exists with non-empty
    value. Missing/empty fields aggregated into single error. Regex duplication
    intentional — distinct semantic context (presence-only vs value-constraint)
  - `state.ts` — RunState persistence to `state.json`, resume logic,
    phase registry (`setPhaseRegistry()`, `getPhaseForNode()`,
    `clearPhaseRegistry()` — see §3.2),
    cost aggregation (`updateRunCost()` sums
    `nodes[*].cost_usd` → `total_cost_usd`; called from
    `markNodeCompleted()` when optional `costUsd` param provided, FR-E17).
    `markNodeCompleted()` also accepts optional `result?: string` param
    (FR-E22) — persists excerpt to `NodeState.result` in `state.json`
  - **IDE CLI wrapper layer (FR-E44)** — maintained in the sibling repo
    [`korchasa/ai-ide-cli`](https://github.com/korchasa/ai-ide-cli),
    published separately on JSR. Runtime adapters, low-level
    Claude/OpenCode/Cursor runners, stream parsers, HITL MCP helper, and
    process registry live in that package. Engine pins the dependency
    via `jsr:@korchasa/ai-ide-cli@^0.2.0` in `engine/deno.json` and
    imports via sub-path specifiers (e.g. `@korchasa/ai-ide-cli/runtime`,
    `@korchasa/ai-ide-cli/claude/process`). Library has zero imports
    from engine (one-way dependency invariant). Local development
    resolves the JSR specifier to a sibling checkout through the
    `links` field in the root `deno.json`. See the sibling repo's
    `documents/design.md` for full module descriptions.
  - `agent.ts` — runtime-agnostic agent invocation, continuation loop, retry.
    Agent context injected via `--agent` + `--append-system-prompt` (native
    Claude Code subagents in `.claude/agents/*.md`). Pipeline-specific context
    via `task_template` `{{file(...)}}` (FR-S38). Base system prompt preserved.
    Runtime resolution centralized in `@korchasa/ai-ide-cli/runtime`;
    `runAgent()` resolves the adapter once and keeps continuation semantics
    unchanged across runtimes. `runAgent()` wires `hitlMcpCommandBuilder`
    from `engine/hitl-mcp-command.ts` for OpenCode HITL.
    **Permission mode (FR-E40):** `PermissionMode` type in
    `@korchasa/ai-ide-cli/types`. Optional field on `WorkflowDefaults` and
    `NodeConfig`. Resolution cascade: node → defaults → omit. Config
    validation rejects invalid values. Non-claude runtimes (`opencode`,
    `cursor`) accept only `bypassPermissions`.
    Low-level CLI invocation, stream parsing, event formatting, and
    `FileReadTracker` live in `@korchasa/ai-ide-cli` — see the sibling
    repo's `documents/design/01-modules.md` for details

