#!/usr/bin/env bash
# stage-9-meta-agent.sh — Stage 9: Meta-Agent (Prompt Optimization).
# Runs after every pipeline execution (success or failure).
# Analyzes logs, produces 07-meta-report.md, applies prompt improvements.
# See: requirements.md FR-11, FR-10.
#
# Usage: stage-9-meta-agent.sh <issue-number>
#
# Environment: SDLC_FAILED_STAGE — set to failed stage number (if any).
#
# When sourced with --source-only, only defines functions (for testing).
#
# DEPRECATED: This script is superseded by the Deno/TypeScript pipeline engine.
# Use `deno task run` instead. Retained for backward compatibility only.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=lib.sh disable=SC1091
source "$SCRIPT_DIR/lib.sh"

STAGE_NAME="stage-9-meta-agent"
AGENT_PROMPT="$REPO_ROOT/.claude/skills/agent-meta-agent/SKILL.md"

# ============================================================
# validate_meta_report_sections()
# Checks 07-meta-report.md has required sections.
# Usage: validate_meta_report_sections <path>
# Returns: 0 if valid, 1 otherwise.
# ============================================================
validate_meta_report_sections() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Meta report is empty or missing: ${path}"
    return 1
  fi

  # Must have Run Summary
  if ! grep -qi 'Run Summary\|run summary' "$path"; then
    log ERROR "Meta report missing Run Summary section: ${path}"
    return 1
  fi

  # Must have Friction Points or Prompt Improvements
  if ! grep -qi 'Friction\|Prompt Improvement\|prompt improvement' "$path"; then
    log ERROR "Meta report missing Friction Points or Prompt Improvements: ${path}"
    return 1
  fi

  log INFO "Meta report sections validated: ${path}"
  return 0
}

# ============================================================
# validate_evidence_based()
# Checks that report contains log references (evidence).
# Usage: validate_evidence_based <path>
# Returns: 0 if evidence found, 1 otherwise.
# ============================================================
validate_evidence_based() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Meta report is empty or missing: ${path}"
    return 1
  fi

  # Check for log file references or stage references
  if ! grep -qiE '(stage-[0-9]|\.jsonl|\.json|log|transcript)' "$path"; then
    log ERROR "Meta report lacks evidence (no log/stage references): ${path}"
    return 1
  fi

  log INFO "Evidence-based validation passed: ${path}"
  return 0
}

# ============================================================
# build_task_prompt()
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local failed_stage="${SDLC_FAILED_STAGE:-}"

  local status_msg="Pipeline completed successfully."
  if [[ -n "$failed_stage" ]]; then
    status_msg="Pipeline FAILED at stage ${failed_stage}."
  fi

  cat <<EOF
Issue #${issue_number}

Pipeline status: ${status_msg}

Instructions:
1. Read all logs in .sdlc/pipeline/${issue_number}/logs/.
2. Read all artifacts in .sdlc/pipeline/${issue_number}/.
3. Read current agent prompts in .claude/skills/agent-*/.
4. Check previous meta-reports: .sdlc/pipeline/*/07-meta-report.md.
5. Create .sdlc/pipeline/${issue_number}/07-meta-report.md with:
   - Run Summary (stages completed/failed, continuations)
   - Error Analysis (if failed: root cause hypothesis)
   - Friction Points (continuations, low quality, excessive tokens)
   - Prompt Improvements Applied (concrete diffs, commit changes)
   - Pattern Tracking (recurring issues)
6. Apply prompt improvements to .claude/skills/agent-*/SKILL.md files.
7. Post summary on issue: \`gh issue comment ${issue_number} --body "<findings>"\`
EOF
}

# ============================================================
# main()
# ============================================================
main() {
  local issue_number="${1:-}"

  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-9-meta-agent.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local report_path="${pipeline_dir}/07-meta-report.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}.json"
  local allowed_paths=(
    ".sdlc/pipeline/${issue_number}/"
    ".claude/skills/"
  )

  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 9: Meta-Agent — Issue #${issue_number} ==="

  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number")

  report_status "$issue_number" "Stage 9 (Meta-Agent): started"

  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$report_path")
  echo "$output" > "$log_json"

  # Post-agent validation
  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_meta_report_sections "$report_path" \
     || ! validate_evidence_based "$report_path"; do

    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: meta report validation failed"
      report_status "$issue_number" "Stage 9 (Meta-Agent): FAILED — validation failed after ${max_cont} continuations"
      exit 1
    fi

    (( cont++ ))
    local error_msg="07-meta-report.md must have: Run Summary, Friction Points/Prompt Improvements. Must reference specific logs/stages as evidence."

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix 07-meta-report.md." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  if ! safety_check_diff "${allowed_paths[@]}"; then
    log ERROR "Safety check failed"
    report_status "$issue_number" "Stage 9 (Meta-Agent): FAILED — safety check failed"
    exit 1
  fi

  if [[ -n "$session_id" ]]; then
    local jsonl_source
    jsonl_source=$(find "$HOME/.claude/projects/" -name "*.jsonl" -newer "$log_json" 2>/dev/null | head -1)
    if [[ -n "$jsonl_source" ]]; then
      cp "$jsonl_source" "${log_dir}/${STAGE_NAME}.jsonl"
    fi
  fi

  # Commit report + any prompt improvements
  local files_to_commit=("$report_path" "$log_json")

  # Include modified agent prompts
  local modified_agents
  modified_agents=$(git -C "$REPO_ROOT" diff --name-only -- .claude/skills/ 2>/dev/null || true)
  if [[ -n "$modified_agents" ]]; then
    while IFS= read -r f; do
      [[ -n "$f" ]] && files_to_commit+=("$REPO_ROOT/$f")
    done <<< "$modified_agents"
  fi

  commit_artifacts \
    "sdlc(meta-agent): ${issue_number} — meta report and prompt improvements" \
    "${files_to_commit[@]}"

  report_status "$issue_number" "Stage 9 (Meta-Agent): completed"
  log INFO "=== Stage 9: Meta-Agent — completed ==="
}

if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
