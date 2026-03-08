#!/usr/bin/env bash
# stage-7-qa.sh — Stage 7: QA (Quality Assurance).
# Called by stage-6-executor.sh, NOT directly by CI/CD.
# Produces 05-qa-report-<iteration>.md with YAML frontmatter verdict.
# See: requirements.md FR-7, FR-8.
#
# Usage: stage-7-qa.sh <issue-number> <iteration>
#
# When sourced with --source-only, only defines functions (for testing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=lib.sh disable=SC1091
source "$SCRIPT_DIR/lib.sh"

STAGE_NAME="stage-7-qa"
AGENT_PROMPT="$REPO_ROOT/.sdlc/agents/qa.md"

# ============================================================
# extract_verdict()
# Extracts verdict from QA report YAML frontmatter.
# Usage: extract_verdict <path>
# Outputs: PASS or FAIL to stdout. Returns 1 if invalid.
# ============================================================
extract_verdict() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "QA report is empty or missing: ${path}"
    return 1
  fi

  local verdict
  # Primary: yq if available
  if command -v yq &>/dev/null; then
    verdict=$(yq --front-matter=extract '.verdict' "$path" 2>/dev/null || true)
  fi

  # Fallback: sed
  if [[ -z "${verdict:-}" ]]; then
    verdict=$(sed -n '2p' "$path" | grep -oE '(PASS|FAIL)' || true)
  fi

  if [[ "$verdict" != "PASS" && "$verdict" != "FAIL" ]]; then
    log ERROR "Invalid verdict '${verdict:-empty}' in: ${path}"
    return 1
  fi

  echo "$verdict"
  return 0
}

# ============================================================
# validate_qa_report()
# Checks QA report has valid YAML frontmatter and required content.
# Usage: validate_qa_report <path>
# Returns: 0 if valid, 1 otherwise.
# ============================================================
validate_qa_report() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "QA report is empty or missing: ${path}"
    return 1
  fi

  # Must start with ---
  local first_line
  first_line=$(head -1 "$path")
  if [[ "$first_line" != "---" ]]; then
    log ERROR "QA report must start with YAML frontmatter (---): ${path}"
    return 1
  fi

  # Must have valid verdict
  if ! extract_verdict "$path" >/dev/null; then
    return 1
  fi

  log INFO "QA report validated: ${path}"
  return 0
}

# ============================================================
# build_task_prompt()
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local iteration="$2"
  local spec_path="$3"
  local decision_path="$4"
  local report_path="$5"

  cat <<EOF
Issue #${issue_number} — QA Iteration ${iteration}

Specification: ${spec_path}
Decision: ${decision_path}
QA report output: ${report_path}

Instructions:
1. Run \`deno task check\` and capture the output.
2. Read ${spec_path} for acceptance criteria.
3. Read ${decision_path} for task breakdown.
4. Review all changed files via \`git diff\`.
5. Create ${report_path} with:
   - YAML frontmatter: \`verdict: PASS\` or \`verdict: FAIL\`
   - Check Results: deno task check output summary
   - Acceptance Criteria: pass/fail per criterion
   - Issues Found: description, file, severity (blocking/non-blocking)
   - Verdict Details: explanation
6. Do NOT modify any code. Only produce the report.
EOF
}

# ============================================================
# main()
# ============================================================
main() {
  local issue_number="${1:-}"
  local iteration="${2:-}"

  if [[ -z "$issue_number" || -z "$iteration" ]]; then
    log ERROR "Usage: stage-7-qa.sh <issue-number> <iteration>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  if ! [[ "$iteration" =~ ^[0-9]+$ ]]; then
    log ERROR "Iteration must be numeric: ${iteration}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local spec_path="${pipeline_dir}/01-spec.md"
  local decision_path="${pipeline_dir}/04-decision.md"
  local report_path="${pipeline_dir}/05-qa-report-${iteration}.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}-${iteration}.json"

  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 7: QA — Issue #${issue_number}, Iteration ${iteration} ==="

  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number" "$iteration" "$spec_path" "$decision_path" "$report_path")

  # Run agent with continuation loop
  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$report_path")
  echo "$output" > "$log_json"

  # Validate QA report
  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_qa_report "$report_path"; do
    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: QA report validation failed"
      exit 1
    fi

    (( cont++ ))
    local error_msg="QA report must start with YAML frontmatter containing 'verdict: PASS' or 'verdict: FAIL'."

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix ${report_path}." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  # Copy JSONL transcript
  if [[ -n "$session_id" ]]; then
    local jsonl_source
    jsonl_source=$(find "$HOME/.claude/projects/" -name "*.jsonl" -newer "$log_json" 2>/dev/null | head -1)
    if [[ -n "$jsonl_source" ]]; then
      cp "$jsonl_source" "${log_dir}/${STAGE_NAME}-${iteration}.jsonl"
    fi
  fi

  # Return verdict via stdout
  local verdict
  verdict=$(extract_verdict "$report_path")
  echo "$verdict"

  log INFO "=== Stage 7: QA — Iteration ${iteration} verdict: ${verdict} ==="
}

if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
