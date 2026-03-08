#!/usr/bin/env bash
# stage-8-presenter.sh — Stage 8: Presenter (Change Summary & PR).
# Produces 06-summary.md, creates PR, posts issue comment.
# See: requirements.md FR-9, FR-8, FR-10, FR-14.
#
# Usage: stage-8-presenter.sh <issue-number>
#
# When sourced with --source-only, only defines functions (for testing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=lib.sh disable=SC1091
source "$SCRIPT_DIR/lib.sh"

STAGE_NAME="stage-8-presenter"
AGENT_PROMPT="$REPO_ROOT/.sdlc/agents/presenter.md"

REQUIRED_SECTIONS=("Executive Summary" "Key Changes" "Testing Summary")

# ============================================================
# validate_summary_sections()
# Checks 06-summary.md has required sections.
# Usage: validate_summary_sections <path>
# Returns: 0 if valid, 1 otherwise.
# ============================================================
validate_summary_sections() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Summary file is empty or missing: ${path}"
    return 1
  fi

  local missing=()
  for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -qi "## .*${section}" "$path"; then
      missing+=("$section")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    log ERROR "Summary missing sections: ${missing[*]}: ${path}"
    return 1
  fi

  log INFO "Summary sections validated: ${path}"
  return 0
}

# ============================================================
# validate_diff_coverage()
# Checks that summary mentions all changed files from git diff.
# Usage: validate_diff_coverage <summary-path>
# Returns: 0 if coverage adequate, 1 otherwise.
# ============================================================
validate_diff_coverage() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Summary file is empty or missing: ${path}"
    return 1
  fi

  local changed_files
  changed_files=$(git -C "$REPO_ROOT" diff --name-only main...HEAD 2>/dev/null || true)

  if [[ -z "$changed_files" ]]; then
    log INFO "No changed files to check coverage for"
    return 0
  fi

  local missing_count=0
  local total_count=0
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    (( total_count++ ))
    local basename
    basename=$(basename "$file")
    if ! grep -q "$basename" "$path"; then
      (( missing_count++ ))
      log WARN "Summary does not mention: ${file}"
    fi
  done <<< "$changed_files"

  if (( missing_count > total_count / 2 )); then
    log ERROR "Summary missing ${missing_count}/${total_count} changed files"
    return 1
  fi

  log INFO "Diff coverage validated: ${missing_count} missing of ${total_count}"
  return 0
}

# ============================================================
# build_task_prompt()
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local spec_path="$2"
  local decision_path="$3"

  cat <<EOF
Issue #${issue_number}

Specification: ${spec_path}
Decision: ${decision_path}

Instructions:
1. Read all pipeline artifacts in .sdlc/pipeline/${issue_number}/.
2. Run \`git diff --name-only main...HEAD\` to get the list of changed files.
3. Run \`git diff --stat main...HEAD\` for change statistics.
4. Create .sdlc/pipeline/${issue_number}/06-summary.md with sections:
   - Executive Summary
   - Key Changes (list all files from git diff)
   - SRS/SDS Changes
   - Testing Summary
   - Known Limitations
5. Create a Pull Request: \`gh pr create --title "Issue #${issue_number}: <title>" --body-file .sdlc/pipeline/${issue_number}/06-summary.md --base main\`
6. Post summary on issue: \`gh issue comment ${issue_number} --body "<short summary>"\`
7. If any gh command fails, stop immediately.
EOF
}

# ============================================================
# main()
# ============================================================
main() {
  local issue_number="${1:-}"

  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-8-presenter.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local spec_path="${pipeline_dir}/01-spec.md"
  local decision_path="${pipeline_dir}/04-decision.md"
  local summary_path="${pipeline_dir}/06-summary.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}.json"
  local allowed_paths=(
    ".sdlc/pipeline/${issue_number}/"
  )

  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 8: Presenter — Issue #${issue_number} ==="

  if ! validate_artifact "$spec_path"; then
    log ERROR "Stage 1 artifact missing: ${spec_path}"
    report_status "$issue_number" "Stage 8 (Presenter): FAILED — missing 01-spec.md"
    exit 1
  fi

  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number" "$spec_path" "$decision_path")

  report_status "$issue_number" "Stage 8 (Presenter): started"

  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$summary_path")
  echo "$output" > "$log_json"

  # Post-agent validation
  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_summary_sections "$summary_path" \
     || ! validate_diff_coverage "$summary_path"; do

    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: summary validation failed"
      report_status "$issue_number" "Stage 8 (Presenter): FAILED — validation failed after ${max_cont} continuations"
      exit 1
    fi

    (( cont++ ))
    local error_msg="06-summary.md must have: Executive Summary, Key Changes, Testing Summary. Must mention all changed files."

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix 06-summary.md." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  if ! safety_check_diff "${allowed_paths[@]}"; then
    log ERROR "Safety check failed"
    report_status "$issue_number" "Stage 8 (Presenter): FAILED — safety check failed"
    exit 1
  fi

  if [[ -n "$session_id" ]]; then
    local jsonl_source
    jsonl_source=$(find "$HOME/.claude/projects/" -name "*.jsonl" -newer "$log_json" 2>/dev/null | head -1)
    if [[ -n "$jsonl_source" ]]; then
      cp "$jsonl_source" "${log_dir}/${STAGE_NAME}.jsonl"
    fi
  fi

  commit_artifacts \
    "sdlc(presenter): ${issue_number} — change summary" \
    "$summary_path" \
    "$log_json"

  report_status "$issue_number" "Stage 8 (Presenter): completed"
  log INFO "=== Stage 8: Presenter — completed ==="
}

if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
