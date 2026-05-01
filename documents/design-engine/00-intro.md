<!-- section file — index: [documents/design-engine.md](../design-engine.md) -->

# SDS Engine — Intro and Architecture


# SDS: Engine

## 1. Intro

- **Purpose:** Implementation details for the domain-agnostic DAG workflow
  engine.
- **Rel to SRS:** Implements FRs from `documents/requirements-engine.md`.

## 2. Architecture

- **Diagram:**

### 2.1 Configurable Node Engine (Deno/TypeScript)

```mermaid
graph TD
    CLI["CLI<br/>deno task run"] --> Engine
    Engine --> Config["Config Loader<br/>.flowai-workflow/workflow.yaml"]
    Engine --> DAG["DAG Builder<br/>toposort → levels"]
    Engine --> State["State Manager<br/>state.json"]

    DAG --> L1["Level 1<br/>(sequential nodes)"]
    DAG --> L2["Level 2<br/>(sequential nodes)"]
    DAG --> LN["Level N<br/>(sequential nodes)"]

    L1 --> Dispatch
    L2 --> Dispatch
    LN --> Dispatch

    subgraph Dispatch["Node Dispatcher"]
        Agent["agent<br/>Claude CLI"]
        Loop["loop<br/>iterative body"]
        Human["human<br/>terminal prompt"]
        Merge["merge<br/>combine outputs"]
    end

    Dispatch --> Validate["Validation<br/>file checks"]
    Dispatch --> Output["Output<br/>4 verbosity levels"]
```

- **Subsystems:**
  - **Workflow Engine** (`engine/`): Deno/TypeScript DAG-based executor
    with YAML config, template interpolation, sequential levels, loop nodes,
    human nodes, resume support, and runtime abstraction (`claude` default,
    `opencode` supported)
  - **Artifact Store**: Git-tracked files in `.flowai-workflow/runs/<run-id>/[<phase>/]<node-id>/`
    (phase subdir present when node has `phase` field in config)
  - **Validation Engine**: Rule-based checks (file_exists, file_not_empty,
    contains_section, custom_script, frontmatter_field)
  - **Continuation Engine**: `--resume` based re-invocation on validation
    failure or safety-check violation (shared `max_continuations` budget)
  - **Binary Distribution** (FR-E39): `deno compile`-based build workflow.
    `scripts/compile.ts` generates self-contained executables for 4 platform
    targets. `.github/workflows/release.yml` publishes GitHub Release assets
    on version tag push
  - **Auto-Update & Release Pipeline** (FR-E41): CLI self-update via GitHub
    Releases API. Two-workflow CI: `ci.yml` (check + auto-bump + tag on main)
    → `release.yml` (compile + publish on tag). Version bumping via
    `standard-version` + conventional commits. `deno.json` version field as
    source of truth

## 3. Components

→ continues in [01-engine-modules-core.md](01-engine-modules-core.md)
(§3.1 first half), [02-engine-modules-flow.md](02-engine-modules-flow.md)
(§3.1 second half), and [03-subsystems.md](03-subsystems.md) (§3.2–§3.6).

