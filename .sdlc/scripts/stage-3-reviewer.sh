#!/usr/bin/env bash
# stage-3-reviewer.sh — Stage 3: Tech Lead Reviewer (Critique & Revision).
# Reads 02-plan.md + 01-spec.md, produces 03-revised-plan.md.
# See: requirements.md FR-4, FR-8, FR-10, FR-14.
#
# Usage: stage-3-reviewer.sh <issue-number>
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
STAGE_NAME="stage-3-reviewer"
AGENT_PROMPT="$REPO_ROOT/.claude/skills/agent-tech-lead-reviewer/SKILL.md"

# Required H2 sections in 03-revised-plan.md
REQUIRED_SECTIONS=("Critique" "Revised Plan" "Recommendation")

# ============================================================
# validate_revised_plan_sections()
# Checks 03-revised-plan.md has all 3 required H2 sections.
# Usage: validate_revised_plan_sections <path>
# Returns: 0 if all present, 1 if any missing.
# ============================================================
validate_revised_plan_sections() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Revised plan file is empty or missing: ${path}"
    return 1
  fi

  local missing=()
  for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -qi "^## .*${section}" "$path"; then
      missing+=("$section")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    log ERROR "Revised plan missing sections: ${missing[*]}: ${path}"
    return 1
  fi

  log INFO "Revised plan sections validated: ${path}"
  return 0
}

# ============================================================
# validate_critique_coverage()
# Checks that critique section references each variant from
# 02-plan.md (at least one critique per variant).
# Usage: validate_critique_coverage <revised-plan-path> <plan-path>
# Returns: 0 if coverage adequate, 1 otherwise.
# ============================================================
validate_critique_coverage() {
  local revised_path="$1"
  local plan_path="$2"

  if [[ ! -s "$revised_path" ]]; then
    log ERROR "Revised plan file is empty or missing: ${revised_path}"
    return 1
  fi

  # Count variants in original plan
  local variant_count
  variant_count=$(grep -c '^## Variant' "$plan_path" || true)

  if (( variant_count == 0 )); then
    log WARN "No variants found in plan: ${plan_path}"
    return 0
  fi

  # Check critique section mentions "Variant" at least variant_count times
  local critique_refs
  critique_refs=$(sed -n '/^## .*[Cc]ritique/,/^## /{ /[Vv]ariant/p; }' "$revised_path" | wc -l)

  if (( critique_refs < variant_count )); then
    log ERROR "Critique covers ${critique_refs}/${variant_count} variants: ${revised_path}"
    return 1
  fi

  log INFO "Critique coverage validated (${critique_refs}/${variant_count}): ${revised_path}"
  return 0
}

# ============================================================
# validate_recommendation()
# Checks that Recommendation section exists and is non-empty.
# Usage: validate_recommendation <path>
# Returns: 0 if recommendation present, 1 otherwise.
# ============================================================
validate_recommendation() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Revised plan file is empty or missing: ${path}"
    return 1
  fi

  # Check for variant reference after the Recommendation heading
  if ! sed -n '/^## .*[Rr]ecommendation/,$p' "$path" | grep -qi 'variant'; then
    log ERROR "Recommendation does not reference a variant: ${path}"
    return 1
  fi

  log INFO "Recommendation validated: ${path}"
  return 0
}

# ============================================================
# build_task_prompt()
# Usage: build_task_prompt <issue-number> <spec-path> <plan-path>
# Outputs: prompt string to stdout.
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local spec_path="$2"
  local plan_path="$3"

  cat <<EOF
Issue #${issue_number}

Plan artifact: ${plan_path}
Specification artifact: ${spec_path}

Instructions:
1. Read ${plan_path} (the Tech Lead plan from Stage 2).
2. Read ${spec_path} (the PM specification from Stage 1).
3. Read documents/requirements.md and documents/design.md.
4. Explore the codebase to verify file references and assumptions.
5. Create .sdlc/pipeline/${issue_number}/03-revised-plan.md with these sections:
   - ## Critique — at least one issue/gap per variant
   - ## Revised Plan — updated variants addressing critique points
   - ## Recommendation — which variant to prefer, with justification
6. Do NOT implement code or modify any files other than 03-revised-plan.md.
EOF
}

# ============================================================
# main()
# ============================================================
main() {
  local issue_number="${1:-}"

  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-3-reviewer.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local spec_path="${pipeline_dir}/01-spec.md"
  local plan_path="${pipeline_dir}/02-plan.md"
  local revised_path="${pipeline_dir}/03-revised-plan.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}.json"
  local allowed_paths=(
    ".sdlc/pipeline/${issue_number}/"
  )

  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 3: Reviewer — Issue #${issue_number} ==="

  # Validate input artifacts
  if ! validate_artifact "$spec_path"; then
    log ERROR "Stage 1 artifact missing: ${spec_path}"
    report_status "$issue_number" "Stage 3 (Reviewer): FAILED — missing 01-spec.md"
    exit 1
  fi
  if ! validate_artifact "$plan_path"; then
    log ERROR "Stage 2 artifact missing: ${plan_path}"
    report_status "$issue_number" "Stage 3 (Reviewer): FAILED — missing 02-plan.md"
    exit 1
  fi

  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number" "$spec_path" "$plan_path")

  report_status "$issue_number" "Stage 3 (Reviewer): started"

  # Run agent with continuation loop
  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$revised_path")
  echo "$output" > "$log_json"

  # Post-agent validation
  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_revised_plan_sections "$revised_path" \
     || ! validate_critique_coverage "$revised_path" "$plan_path" \
     || ! validate_recommendation "$revised_path"; do

    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: revised plan validation failed"
      report_status "$issue_number" "Stage 3 (Reviewer): FAILED — validation failed after ${max_cont} continuations"
      exit 1
    fi

    (( cont++ ))
    local error_msg=""
    if ! validate_revised_plan_sections "$revised_path" 2>/dev/null; then
      error_msg="Revised plan must have sections: Critique, Revised Plan, Recommendation."
    fi
    if ! validate_critique_coverage "$revised_path" "$plan_path" 2>/dev/null; then
      error_msg="${error_msg} Critique must cover every variant from 02-plan.md."
    fi
    if ! validate_recommendation "$revised_path" 2>/dev/null; then
      error_msg="${error_msg} Recommendation must reference a specific variant."
    fi

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix the issues in 03-revised-plan.md." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  if ! safety_check_diff "${allowed_paths[@]}"; then
    log ERROR "Safety check failed"
    report_status "$issue_number" "Stage 3 (Reviewer): FAILED — safety check failed"
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

  commit_artifacts \
    "sdlc(reviewer): ${issue_number} — revised plan" \
    "$revised_path" \
    "$log_json"

  report_status "$issue_number" "Stage 3 (Reviewer): completed"
  log INFO "=== Stage 3: Reviewer — completed ==="
}

if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
