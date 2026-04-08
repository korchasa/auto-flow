# Development Commands

## Shell Environment
- Always use `NO_COLOR=1` when running shell commands — ANSI escape codes waste tokens and clutter output.
- When writing scripts, respect the `NO_COLOR` env var (https://no-color.org/) — disable ANSI colors when it is set.

## Standard Interface

- `check` - The main command for comprehensive project verification. Performs
  the following steps:
  - build the project
  - comment-scan: "TODO", "FIXME", "HACK", "XXX", debugger calls, linters and
    formatters suppression
  - code formatting check
  - static code analysis
  - runs all project tests
- `test <path>` - Runs a single test.
- `dev` - Runs the application in development mode with watch mode enabled.
- `prod` - Runs the application in production mode.

## Detected Commands

- `deno task check` - Full project verification (format, lint, test)
- `deno task test` - Run all tests
- `deno task loop-in-claude` - Autonomous loop: check issues → run workflow via claude CLI → repeat
- `deno fmt` - Format code
- `deno lint` - Lint code
- `deno test` - Run tests

## Command Scripts

- `scripts/check.ts` - Comprehensive check: fmt --check, lint, test,
  comment-scan
- `scripts/loop_in_claude.ts` - Autonomous loop: check issues → run workflow via claude CLI (backoff 30s→4h)
- `scripts/test.ts` - Run single test file or all tests
- `scripts/dev.ts` - Start dev mode (watch)
- `scripts/prod.ts` - Start production mode
