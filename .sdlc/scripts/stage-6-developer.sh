#!/usr/bin/env bash
# stage-6-developer.sh — Stage 6-7: Developer + QA iterative loop.
# Loop controller: invokes Developer agent, then calls stage-7-qa.sh.
# If QA verdict is FAIL, re-invokes Developer with QA report.
# See: requirements.md FR-7, FR-8, FR-10, FR-14.
#
# Usage: stage-6-developer.sh <issue-number>
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

STAGE_NAME="stage-6-developer"
AGENT_PROMPT="$REPO_ROOT/.claude/skills/agent-developer/SKILL.md"
QA_SCRIPT="$SCRIPT_DIR/stage-7-qa.sh"

# Paths forbidden for developer modifications
FORBIDDEN_PATHS=(".github/" ".claude/skills/agent-*/" ".sdlc/scripts/" "CLAUDE.md")

# ============================================================
# extract_developer_allowlist()
# Extracts file allowlist from 04-decision.md YAML frontmatter.
# Usage: extract_developer_allowlist <decision-path>
# Outputs: one path per line to stdout.
# ============================================================
extract_developer_allowlist() {
  local decision_path="$1"

  # Extract YAML frontmatter (between first and second ---), then
  # find file paths in the tasks section (quoted strings in files arrays).
  sed -n '2,/^---$/{/^---$/d; p;}' "$decision_path" \
    | sed -n '/^tasks:/,$p' \
    | grep -oE '"[^"]+"' \
    | tr -d '"'
}

# ============================================================
# validate_developer_diff()
# Checks developer changes against allowlist from 04-decision.md.
# Also checks for forbidden path modifications.
# Usage: validate_developer_diff <decision-path> <issue-number>
# Returns: 0 if safe, 1 if violations found.
# ============================================================
validate_developer_diff() {
  local decision_path="$1"
  local issue_number="$2"

  local changed_files
  changed_files=$(git -C "$REPO_ROOT" diff --name-only HEAD 2>/dev/null || true)

  if [[ -z "$changed_files" ]]; then
    return 0
  fi

  # Check forbidden paths
  local violations=0
  for forbidden in "${FORBIDDEN_PATHS[@]}"; do
    if echo "$changed_files" | grep -q "^${forbidden}"; then
      log ERROR "Developer modified forbidden path: ${forbidden}"
      violations=1
    fi
  done

  if (( violations != 0 )); then
    return 1
  fi

  # Standard safety check
  local allowed_files
  allowed_files=$(extract_developer_allowlist "$decision_path")

  local allowed_paths=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && allowed_paths+=("$f")
  done <<< "$allowed_files"

  # Always allow pipeline directory
  allowed_paths+=(".sdlc/pipeline/${issue_number}/")

  safety_check_diff "${allowed_paths[@]}"
}

# ============================================================
# build_task_prompt()
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local iteration="$2"
  local decision_path="$3"
  local qa_report_path="${4:-}"

  local prompt
  prompt=$(cat <<EOF
Issue #${issue_number} — Developer Iteration ${iteration}

Decision artifact: ${decision_path}

Instructions:
1. Read ${decision_path} (task breakdown from Architect).
2. Read documents/requirements.md and documents/design.md.
3. Implement tasks in order from the YAML frontmatter.
4. Follow TDD: write tests first, then implementation.
5. Run \`deno task check\` after each task and fix any failures.
6. Commit each task separately.
EOF
  )

  if [[ -n "$qa_report_path" && -f "$qa_report_path" ]]; then
    prompt+=$(cat <<EOF

IMPORTANT — Previous QA iteration found issues:
QA report: ${qa_report_path}
Read the QA report and fix ALL blocking issues before proceeding.
EOF
    )
  fi

  echo "$prompt"
}

# ============================================================
# main()
# ============================================================
main() {
  local issue_number="${1:-}"

  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-6-developer.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local decision_path="${pipeline_dir}/04-decision.md"
  local log_dir="${pipeline_dir}/logs"
  local max_iterations="${SDLC_MAX_QA_ITERATIONS}"

  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 6-7: Developer + QA — Issue #${issue_number} ==="

  if ! validate_artifact "$decision_path"; then
    log ERROR "Stage 4 artifact missing: ${decision_path}"
    report_status "$issue_number" "Stage 6 (Developer): FAILED — missing 04-decision.md"
    exit 1
  fi

  report_status "$issue_number" "Stage 6-7 (Developer+QA): started"

  local iteration=1
  local verdict="FAIL"

  while (( iteration <= max_iterations )); do
    log INFO "--- Developer+QA iteration ${iteration}/${max_iterations} ---"

    local log_json="${log_dir}/${STAGE_NAME}-${iteration}.json"
    local prev_qa_report=""
    if (( iteration > 1 )); then
      prev_qa_report="${pipeline_dir}/05-qa-report-$((iteration - 1)).md"
    fi

    # Build and run Developer
    local task_prompt
    task_prompt=$(build_task_prompt "$issue_number" "$iteration" "$decision_path" "$prev_qa_report")

    local output
    output=$(run_agent "$AGENT_PROMPT" "$task_prompt")
    echo "$output" > "$log_json"

    # Continuation loop for deno task check
    local session_id
    session_id=$(echo "$output" | jq -r '.session_id // empty')
    local cont=0
    local max_cont="${SDLC_MAX_CONTINUATIONS}"

    # Run deno task check and continue if it fails
    local check_output
    check_output=$(deno task check 2>&1 || true)
    local check_exit=$?

    while (( check_exit != 0 )); do
      if (( cont >= max_cont )); then
        log ERROR "Continuation limit reached: deno task check keeps failing"
        break
      fi

      (( cont++ ))
      log WARN "deno task check failed, continuation ${cont}/${max_cont}"
      output=$(retry_with_backoff claude \
        --resume "$session_id" \
        -p "deno task check failed with: ${check_output}. Fix the issues." \
        --output-format json)
      echo "$output" > "$log_json"

      check_output=$(deno task check 2>&1 || true)
      check_exit=$?
    done

    # Validate developer diff
    if ! validate_developer_diff "$decision_path" "$issue_number"; then
      log ERROR "Developer safety check failed"
      report_status "$issue_number" "Stage 6 (Developer): FAILED — safety check failed at iteration ${iteration}"
      exit 1
    fi

    # Commit developer work
    commit_artifacts \
      "sdlc(developer): ${issue_number} — implementation iteration ${iteration}" \
      "."

    # Copy developer JSONL
    if [[ -n "$session_id" ]]; then
      local jsonl_source
      jsonl_source=$(find "$HOME/.claude/projects/" -name "*.jsonl" -newer "$log_json" 2>/dev/null | head -1)
      if [[ -n "$jsonl_source" ]]; then
        cp "$jsonl_source" "${log_dir}/${STAGE_NAME}-${iteration}.jsonl"
      fi
    fi

    # Run QA
    log INFO "Running QA for iteration ${iteration}..."
    verdict=$("$QA_SCRIPT" "$issue_number" "$iteration" | grep -oE '(PASS|FAIL)' || echo "FAIL")

    # Commit QA report
    local qa_report="${pipeline_dir}/05-qa-report-${iteration}.md"
    if [[ -f "$qa_report" ]]; then
      commit_artifacts \
        "sdlc(qa): ${issue_number} — QA report iteration ${iteration}" \
        "$qa_report"
    fi

    if [[ "$verdict" == "PASS" ]]; then
      log INFO "QA PASSED at iteration ${iteration}"
      break
    fi

    log WARN "QA FAILED at iteration ${iteration}"
    (( iteration++ ))
  done

  if [[ "$verdict" != "PASS" ]]; then
    log ERROR "QA failed after ${max_iterations} iterations"
    report_status "$issue_number" "Stage 6-7 (Developer+QA): FAILED — QA failed after ${max_iterations} iterations"
    exit 1
  fi

  report_status "$issue_number" "Stage 6-7 (Developer+QA): completed"
  log INFO "=== Stage 6-7: Developer + QA — completed ==="
}

if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
