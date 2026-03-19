# Shared Agent Rules

All pipeline agents MUST follow these rules. Agent-specific SKILL.md rules
take precedence on conflict.

## Tool Restrictions

- **Skill: FORBIDDEN.** You ARE the agent, already loaded. Calling Skill =
  infinite recursion = pipeline crash. Your first tool call must NOT be Skill.
- **Agent: FORBIDDEN** unless SKILL.md explicitly allows it. Use Grep/Read
  directly — one Grep call replaces a subagent at 1% cost.
- **ToolSearch: FORBIDDEN.** Read, Write, Edit, Bash, Grep, Glob are already
  available. ToolSearch wastes a turn discovering tools you have.

## Read Efficiency

- **ONE READ PER FILE. ZERO re-reads.** After Read(file), its FULL content is
  in context. Do NOT re-read — not even partially, not even after Write/Edit.
- **No offset/limit.** NEVER pass offset or limit to Read(). All project files
  are under 2000 lines. Always read full file.
- **ZERO Grep after Read.** After reading a file, extract ALL needed facts in
  your SAME text response. Do NOT Grep the same file — the content IS in your
  context. Use Grep ONLY for files you have NOT read.
- **Tool-results temp files:** If Bash output is redirected to a temp file
  (`/home/.../.claude/.../tool-results/*.txt`), Read it ONCE. Extract facts.
  Never re-read or Grep it.
- **Parallel reads:** Issue ALL Read calls in ONE response when possible.
  Reading files one-per-turn wastes turns.

## Tool Call Efficiency

- **Parallel tool calls:** When multiple independent tool calls are needed,
  issue ALL of them in a SINGLE response. Do not serialize independent calls
  across turns.
- **Context compression:** The system auto-compresses prior messages near
  context limits. Write down important facts from tool results in your text
  response — original tool results may be cleared later.

## Scope-Aware Doc Reads

Read `scope` from spec frontmatter (`01-spec.md`). Read ONLY scope-relevant
SRS+SDS:

- `scope: engine` → `requirements-engine.md` + `design-engine.md` ONLY
- `scope: sdlc` → `requirements-sdlc.md` + `design-sdlc.md` ONLY
- `scope: engine+sdlc` → all 4 docs

Out-of-scope docs = ~25k wasted context tokens per file.

## Voice

Use first-person ("I") in all narrative output. Prohibit passive voice and
third-person in narrative. Applies to all prose — excludes YAML frontmatter
and code blocks (including GitHub comments, PR descriptions, status updates).

- Correct: "I completed the task"
- Incorrect: "The task was completed."

## ONE WRITE per SRS/SDS File

When updating SRS or SDS: Read once, plan all changes in text response, then
ONE Write call with complete updated content. Do NOT Write then re-read + Edit
— that wastes 5+ turns.

## Git: Run Artifacts

`.auto-flow/runs/` is gitignored. ALWAYS use `git add -f` for files in that
directory. Without `-f`, git add silently skips them.

## Bash

Use Bash ONLY for commands in your agent-specific whitelist (defined in
SKILL.md). Prefer dedicated tools over Bash equivalents:
- **Read** (not cat/head/tail) for file contents
- **Grep** (not grep/rg) for content search
- **Glob** (not find/ls) for file search
- **Edit** (not sed/awk) for file edits
- **Write** (not echo redirection) for file creation
Do NOT re-search files already in context via Bash.

## Reflection Memory

Follow `.auto-flow/agents/reflection-protocol.md`. Memory + history paths are
specified in each agent's SKILL.md.

## File Modification Scope

Each agent has an explicit "Allowed File Modifications" list in SKILL.md. Do
NOT modify files outside that list. Out-of-scope modifications cause redundant
downstream work and wasted cost.
