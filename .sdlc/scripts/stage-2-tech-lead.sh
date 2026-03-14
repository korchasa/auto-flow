#!/usr/bin/env bash
# stage-2-tech-lead.sh — Stage 2: Tech Lead (Plan with Variants).
# Reads 01-spec.md, produces 02-plan.md with 2-3 implementation variants.
# See: requirements.md FR-3, FR-8, FR-10, FR-14.
#
# Usage: stage-2-tech-lead.sh <issue-number>
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

# ============================================================
# Constants
# ============================================================
STAGE_NAME="stage-2-tech-lead"
AGENT_PROMPT="$REPO_ROOT/.claude/skills/agent-tech-lead/SKILL.md"

# ============================================================
# validate_plan_variants()
# Checks that 02-plan.md contains 2-3 variants (H2 headings
# matching "## Variant").
# Usage: validate_plan_variants <path>
# Returns: 0 if 2-3 variants, 1 otherwise.
# ============================================================
validate_plan_variants() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Plan file is empty or missing: ${path}"
    return 1
  fi

  local count
  count=$(grep -c '^## Variant' "$path" || true)

  if (( count < 2 )); then
    log ERROR "Plan has ${count} variant(s), need 2-3: ${path}"
    return 1
  fi

  if (( count > 3 )); then
    log ERROR "Plan has ${count} variant(s), need 2-3: ${path}"
    return 1
  fi

  log INFO "Plan variant count validated (${count}): ${path}"
  return 0
}

# ============================================================
# validate_plan_quality()
# Checks that each variant has concrete file refs, effort, risk.
# Usage: validate_plan_quality <path>
# Returns: 0 if all quality checks pass, 1 otherwise.
# ============================================================
validate_plan_quality() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Plan file is empty or missing: ${path}"
    return 1
  fi

  local errors=0

  # Check for concrete file references (backtick-quoted paths)
  # shellcheck disable=SC2016
  if ! grep -qiE '(affected files|files).*`[^`]+`' "$path"; then
    log ERROR "Plan missing concrete file references (backtick-quoted paths): ${path}"
    errors=1
  fi

  # Check for effort estimates (matches **Effort in Markdown bold)
  if ! grep -qi '\*\*Effort' "$path"; then
    log ERROR "Plan missing effort estimates: ${path}"
    errors=1
  fi

  # Check for risk assessment (matches **Risk or **Risks in Markdown bold)
  if ! grep -qi '\*\*Risk' "$path"; then
    log ERROR "Plan missing risk assessment: ${path}"
    errors=1
  fi

  if (( errors == 0 )); then
    log INFO "Plan quality validated: ${path}"
  fi

  return $errors
}

# ============================================================
# build_task_prompt()
# Constructs the task prompt from issue number and spec path.
# Usage: build_task_prompt <issue-number> <spec-path>
# Outputs: prompt string to stdout.
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local spec_path="$2"

  cat <<EOF
Issue #${issue_number}

Specification artifact: ${spec_path}

Instructions:
1. Read ${spec_path} (the PM specification from Stage 1).
2. Read documents/requirements-sdlc.md and documents/design-sdlc.md.
3. Explore the codebase to identify affected files and modules.
4. Create .sdlc/pipeline/${issue_number}/02-plan.md with 2-3 implementation variants.
   Each variant MUST include:
   - Description of the approach
   - Affected files (concrete backtick-quoted paths from the codebase)
   - Effort estimate (S/M/L relative to other variants)
   - At least one risk
5. Do NOT implement code or modify any files other than 02-plan.md.
EOF
}

# ============================================================
# main()
# Orchestrates Stage 2: Tech Lead agent invocation with validation.
# ============================================================
main() {
  local issue_number="${1:-}"

  # Validate argument
  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-2-tech-lead.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local spec_path="${pipeline_dir}/01-spec.md"
  local plan_path="${pipeline_dir}/02-plan.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}.json"
  local allowed_paths=(
    ".sdlc/pipeline/${issue_number}/"
  )

  # Create pipeline directories
  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 2: Tech Lead — Issue #${issue_number} ==="

  # Validate input artifact from Stage 1
  if ! validate_artifact "$spec_path"; then
    log ERROR "Stage 1 artifact missing: ${spec_path}"
    report_status "$issue_number" "Stage 2 (Tech Lead): FAILED — missing 01-spec.md"
    exit 1
  fi

  # Build task prompt
  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number" "$spec_path")

  # Report start
  report_status "$issue_number" "Stage 2 (Tech Lead): started"

  # Run agent with continuation loop for artifact validation
  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$plan_path")
  echo "$output" > "$log_json"

  # Post-agent validation: check 2-3 variants with quality metrics
  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_plan_variants "$plan_path" || ! validate_plan_quality "$plan_path"; do
    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: plan validation failed"
      report_status "$issue_number" "Stage 2 (Tech Lead): FAILED — plan validation failed after ${max_cont} continuations"
      exit 1
    fi

    (( cont++ ))
    local error_msg=""
    if ! validate_plan_variants "$plan_path" 2>/dev/null; then
      error_msg="Plan must have 2-3 variants (H2 headings starting with '## Variant')."
    fi
    if ! validate_plan_quality "$plan_path" 2>/dev/null; then
      error_msg="${error_msg} Each variant must have: concrete file references (backtick-quoted), effort estimate (S/M/L), and at least one risk."
    fi

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix the issues in 02-plan.md." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  # Safety check: no out-of-scope modifications or secrets
  if ! safety_check_diff "${allowed_paths[@]}"; then
    log ERROR "Safety check failed: out-of-scope changes or secrets detected"
    report_status "$issue_number" "Stage 2 (Tech Lead): FAILED — safety check failed"
    exit 1
  fi

  # Copy JSONL transcript (FR-10)
  if [[ -n "$session_id" ]]; then
    local jsonl_source
    jsonl_source=$(find "$HOME/.claude/projects/" -name "*.jsonl" -newer "$log_json" 2>/dev/null | head -1)
    if [[ -n "$jsonl_source" ]]; then
      cp "$jsonl_source" "${log_dir}/${STAGE_NAME}.jsonl"
    fi
  fi

  # Commit artifacts (FR-14)
  commit_artifacts \
    "sdlc(tech-lead): ${issue_number} — implementation plan" \
    "$plan_path" \
    "$log_json"

  # Report success
  report_status "$issue_number" "Stage 2 (Tech Lead): completed"
  log INFO "=== Stage 2: Tech Lead — completed ==="
}

# Allow sourcing for testing without executing main
if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
