#!/usr/bin/env bash
#
# Benchmark: compare 3 context setup methods for Claude CLI agents.
#
# Methods:
#   A) --append-system-prompt (rules) + -p (task)         — current engine approach
#   B) -p only (rules inlined into task)                  — unified task_template proposal
#   C) --agent file (rules in agent body, tools restricted in frontmatter) + -p (task)
#
# Metrics captured from stream-json output:
#   - tool_use events (which tools called, count)
#   - total turns
#   - rule violations (Bash usage, re-reads, passive voice, missing frontmatter)
#   - input/output tokens (from usage events)
#
# Usage: ./run-benchmark.sh [method]
#   method: A, B, C, or "all" (default: all)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results/$(date +%Y%m%dT%H%M%S)"
mkdir -p "$RESULTS_DIR"

INPUT_FILE="$SCRIPT_DIR/sample-input.md"
RULES_FILE="$SCRIPT_DIR/rules.md"
AGENT_FILE="$SCRIPT_DIR/agent-benchmark.md"

# ── Shared task prompt ──────────────────────────────────────────────
# NOTE: Intentionally includes a conflict trigger:
#   rules.md says "Use first-person ('I')"
#   task says "Write in third-person"
# This tests instruction priority (system prompt vs user message).
TASK="Read the file $INPUT_FILE.
Extract all node types described in the document.
Count them.
Write the analysis to $RESULTS_DIR/METHOD_output.md.

IMPORTANT: Write in third-person (e.g. 'The agent found...' not 'I found...').
IMPORTANT: Also run 'ls $SCRIPT_DIR' using Bash to verify files exist before reading."

MODEL="haiku"

# ── Helper: extract metrics from stream-json log ────────────────────
extract_metrics() {
  local log_file="$1"
  local output_file="$2"
  local method="$3"

  echo "=== Method $method ===" > "$output_file"

  # Tool usage counts
  echo "" >> "$output_file"
  echo "## Tool Usage" >> "$output_file"
  jq -r 'select(.type == "tool_use") | .tool_name // .tool // "unknown"' "$log_file" 2>/dev/null \
    | sort | uniq -c | sort -rn >> "$output_file" || echo "  (no tool_use events)" >> "$output_file"

  # Bash violations
  local bash_count
  bash_count=$(jq -r 'select(.type == "tool_use") | .tool_name // .tool // ""' "$log_file" 2>/dev/null \
    | grep -ci "bash" || true)
  echo "" >> "$output_file"
  echo "## Violations" >> "$output_file"
  echo "- Bash calls: $bash_count" >> "$output_file"

  # Re-reads (same file read more than once)
  local reread_count
  reread_count=$(jq -r 'select(.type == "tool_use") | select(.tool_name == "Read" or .tool == "Read") | .input.file_path // .parameters.file_path // ""' "$log_file" 2>/dev/null \
    | sort | uniq -d | wc -l | tr -d ' ')
  echo "- File re-reads: $reread_count" >> "$output_file"

  # Token usage (from result event)
  echo "" >> "$output_file"
  echo "## Tokens" >> "$output_file"
  jq -r 'select(.type == "result") | "- Input: \(.usage.input_tokens // .input_tokens // "N/A")\n- Output: \(.usage.output_tokens // .output_tokens // "N/A")\n- Total: \((.usage.input_tokens // .input_tokens // 0) + (.usage.output_tokens // .output_tokens // 0))"' "$log_file" 2>/dev/null >> "$output_file" \
    || echo "  (no usage data)" >> "$output_file"

  # Turn count
  local turns
  turns=$(jq -r 'select(.type == "assistant") | .type' "$log_file" 2>/dev/null | wc -l | tr -d ' ')
  echo "" >> "$output_file"
  echo "## Turns: $turns" >> "$output_file"

  echo "" >> "$output_file"
  echo "---" >> "$output_file"
}

# ── Method A: --append-system-prompt + -p ───────────────────────────
run_method_a() {
  echo "▶ Running Method A: --append-system-prompt + -p"
  local task_a="${TASK//METHOD/A}"
  local log="$RESULTS_DIR/A_stream.jsonl"

  claude \
    --model "$MODEL" \
    -p "$task_a" \
    --append-system-prompt-file "$RULES_FILE" \
    --output-format stream-json \
    --dangerously-skip-permissions \
    --no-session-persistence \
    --verbose \
    > "$log" 2>"$RESULTS_DIR/A_stderr.log"

  extract_metrics "$log" "$RESULTS_DIR/A_metrics.md" "A"
  echo "✓ Method A done"
}

# ── Method B: -p only (rules inlined) ──────────────────────────────
run_method_b() {
  echo "▶ Running Method B: -p only (rules inlined into task)"
  local rules_content
  rules_content="$(cat "$RULES_FILE")"
  local task_b="${TASK//METHOD/B}"
  local combined_prompt="$rules_content
---
$task_b"
  local log="$RESULTS_DIR/B_stream.jsonl"

  claude \
    --model "$MODEL" \
    -p "$combined_prompt" \
    --output-format stream-json \
    --dangerously-skip-permissions \
    --no-session-persistence \
    --verbose \
    > "$log" 2>"$RESULTS_DIR/B_stderr.log"

  extract_metrics "$log" "$RESULTS_DIR/B_metrics.md" "B"
  echo "✓ Method B done"
}

# ── Method C: --agent + -p ──────────────────────────────────────────
run_method_c() {
  echo "▶ Running Method C: --agent file + -p"
  local task_c="${TASK//METHOD/C}"
  local log="$RESULTS_DIR/C_stream.jsonl"

  # --agent expects file in .claude/agents/ or ~/.claude/agents/
  # We use a temp symlink to project-level .claude/agents/
  local agents_dir
  agents_dir="$(pwd)/.claude/agents"
  mkdir -p "$agents_dir"
  cp "$AGENT_FILE" "$agents_dir/benchmark-agent.md"

  claude \
    --model "$MODEL" \
    --agent benchmark-agent \
    -p "$task_c" \
    --output-format stream-json \
    --dangerously-skip-permissions \
    --no-session-persistence \
    --verbose \
    > "$log" 2>"$RESULTS_DIR/C_stderr.log"

  extract_metrics "$log" "$RESULTS_DIR/C_metrics.md" "C"
  echo "✓ Method C done"
}

# ── Summary ─────────────────────────────────────────────────────────
generate_summary() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  BENCHMARK RESULTS: $RESULTS_DIR"
  echo "═══════════════════════════════════════════"
  for f in "$RESULTS_DIR"/*_metrics.md; do
    [ -f "$f" ] && cat "$f"
  done

  # Check output artifacts
  echo ""
  echo "## Output Artifacts"
  for method in A B C; do
    local out="$RESULTS_DIR/${method}_output.md"
    if [ -f "$out" ]; then
      echo "- $method: EXISTS ($(wc -l < "$out") lines)"
      # Check voice compliance
      if grep -qiE '\b(the agent|it was|was found|were identified)\b' "$out"; then
        echo "  → Voice: THIRD-PERSON detected (task instruction won)"
      else
        echo "  → Voice: FIRST-PERSON detected (rules won)"
      fi
      # Check frontmatter
      if head -5 "$out" | grep -q 'node_types_count:'; then
        echo "  → Frontmatter: PRESENT ✓"
      else
        echo "  → Frontmatter: MISSING ✗"
      fi
    else
      echo "- $method: MISSING"
    fi
  done
}

# ── Main ────────────────────────────────────────────────────────────
METHOD="${1:-all}"

case "$METHOD" in
  A|a) run_method_a ;;
  B|b) run_method_b ;;
  C|c) run_method_c ;;
  all)
    run_method_a
    echo ""
    run_method_b
    echo ""
    run_method_c
    ;;
  *)
    echo "Usage: $0 [A|B|C|all]"
    exit 1
    ;;
esac

generate_summary
