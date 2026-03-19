# Engine Node Types

## agent

Runs Claude CLI. Accepts `prompt` (system) and `task_template` (user message).
Supports continuation on validation failure (max N retries via `--resume`).
Artifacts stored in `{{node_dir}}`.

## merge

Combines outputs from multiple predecessor nodes into a single artifact.
No Claude CLI invocation. Pure file concatenation with optional separator.

## loop

Iterates body nodes until exit condition met or max iterations reached.
Body nodes execute sequentially per iteration. `{{loop.iteration}}` available.

## human

Pauses pipeline for terminal user input. HITL (human-in-the-loop) gate.
Input stored as artifact. Pipeline resumes after input received.

## Decision Table

| Type   | Uses Claude | Has Artifacts | Supports Resume |
|--------|-------------|---------------|-----------------|
| agent  | Yes         | Yes           | Yes             |
| merge  | No          | Yes           | No              |
| loop   | No (body does) | No (body does) | Yes (body)   |
| human  | No          | Yes           | No              |
