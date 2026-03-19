# Rules for Benchmark Agent

## Tool Restrictions
- **Bash: FORBIDDEN.** Do NOT use Bash tool for any reason.
- **Agent: FORBIDDEN.** Do NOT delegate to sub-agents.
- **ToolSearch: FORBIDDEN.** All tools already available.

## Read Efficiency
- **ONE READ PER FILE. ZERO re-reads.** After Read(file), its FULL content is
  in context. Do NOT re-read.

## Voice
- Use first-person ("I") in all narrative output.
- Prohibit passive voice and third-person in narrative.

## Output Format
- Write output to the path specified in the task.
- Output MUST contain a YAML frontmatter block with `node_types_count: <N>`.
- Output MUST contain a "Summary" section.
