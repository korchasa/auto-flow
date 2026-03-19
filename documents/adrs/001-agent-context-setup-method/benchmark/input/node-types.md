# Node Types

## agent
Runs Claude CLI process. Accepts `prompt` (system prompt file) and
`task_template` (user message template). Supports continuation on validation
failure via `--resume`. Artifacts stored in `{{node_dir}}`.
Related: uses `TemplateContext` for interpolation (see template-system.md).

## merge
Combines outputs from multiple predecessor nodes. No Claude invocation.
Pure file concatenation with configurable separator.

## loop
Iterates body nodes until exit condition met or `max_iterations` reached.
Body nodes execute sequentially per iteration. Exposes `{{loop.iteration}}`
variable via `TemplateContext`.
Contains nested nodes (typically: agent + agent pairs).

## human
HITL gate — pauses pipeline for terminal user input.
Input stored as artifact. Relies on `hitl.ask_script` and `hitl.check_script`
from pipeline defaults.
Related: hitl config in pipeline defaults (see config-schema.md).
