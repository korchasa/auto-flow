# Config Schema

## Pipeline Top-Level
- `name` (string, required) — pipeline identifier
- `version` (string, required) — config version
- `pre_run` (string, optional) — script executed before pipeline start
- `defaults` (object) — default settings for all nodes
- `phases` (object) — phase-to-node mapping
- `nodes` (object, required) — node definitions

## Node Fields
- `type` (enum: agent|merge|loop|human, required)
- `phase` (string, optional) — assigns node to a phase
- `label` (string, required) — human-readable name
- `prompt` (string, optional) — path to system prompt file (agent only)
- `task_template` (string, optional) — user message template (agent only)
- `model` (string, optional) — model override
- `inputs` (string[], optional) — predecessor node IDs
- `validate` (object[], optional) — artifact validation rules
- `settings` (object, optional) — per-node settings override
- `run_on` (enum: success|always, default: success)

## Defaults Object
- `max_parallel` (int) — concurrent node limit
- `max_continuations` (int) — validation retry limit
- `timeout_seconds` (int) — per-node timeout
- `max_retries` (int) — CLI crash retry limit
- `retry_delay_seconds` (int) — backoff between retries
- `model` (string) — default model
- `claude_args` (string[]) — extra CLI flags
- `on_failure_script` (string) — rollback script
- `hitl` (object) — human-in-the-loop config

## HITL Config
- `ask_script` (string) — script to solicit human input
- `check_script` (string) — script to poll for response
- `artifact_source` (string) — path to artifact shown to human
- `poll_interval` (int, seconds)
- `timeout` (int, seconds)
- `exclude_login` (string) — GitHub login to ignore

## Validation Rules
Types: `file_exists`, `file_not_empty`, `frontmatter_field`,
`contains_section`, `custom_script`.
Each rule references `{{node_dir}}` for artifact paths.
Cross-reference: `agent` nodes use validate rules; `merge`/`human` do not.
