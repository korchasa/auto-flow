# Template System

## TemplateContext
The interpolation context available to `task_template` fields:
- `{{node_dir}}` — current node's artifact directory
- `{{run_dir}}` — run root directory
- `{{input.<node-id>}}` — predecessor node's output directory
- `{{args.<key>}}` — CLI arguments passed via `--prompt`
- `{{env.<key>}}` — environment variables
- `{{loop.iteration}}` — current loop iteration (loop body only)
- `{{file("path")}}` — inline file content (single-pass, no re-interpolation)

## file() Function
Reads file content and inserts it verbatim. Path resolved relative to CWD.
Single-pass: included content is NOT re-interpolated (prevents recursion).
Warning emitted if file > 100KB.
Error thrown if file not found (fail-fast).

## Interpolation Rules
- Unresolved `{{...}}` placeholders throw immediately (fail-fast).
- Template variables are resolved at runtime, not at config load time.
- `prompt` field paths are validated and cached at config load time.
- `task_template` content is interpolated per-invocation.

## Known Limitation
`file()` content is not re-interpolated. If included file contains `{{...}}`
markers, they appear as literal text in the output. This is intentional to
prevent infinite include loops.
