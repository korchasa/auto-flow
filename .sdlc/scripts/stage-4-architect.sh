#!/usr/bin/env bash
# stage-4-architect.sh — Stage 4: Architect (Variant Selection & Task Breakdown).
# Reads 03-revised-plan.md, produces 04-decision.md with YAML frontmatter.
# See: requirements.md FR-5, FR-8, FR-10, FR-14.
#
# Usage: stage-4-architect.sh <issue-number>
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

STAGE_NAME="stage-4-architect"
AGENT_PROMPT="$REPO_ROOT/.claude/skills/agent-architect/SKILL.md"

# ============================================================
# validate_yaml_frontmatter()
# Checks 04-decision.md starts with YAML frontmatter containing
# required fields: variant (string) and tasks (array).
# Usage: validate_yaml_frontmatter <path>
# Returns: 0 if valid, 1 otherwise.
# ============================================================
validate_yaml_frontmatter() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Decision file is empty or missing: ${path}"
    return 1
  fi

  # Check starts with ---
  local first_line
  first_line=$(head -1 "$path")
  if [[ "$first_line" != "---" ]]; then
    log ERROR "Decision file must start with YAML frontmatter (---): ${path}"
    return 1
  fi

  # Extract frontmatter
  local frontmatter
  frontmatter=$(sed -n '2,/^---$/{/^---$/d; p;}' "$path")

  if [[ -z "$frontmatter" ]]; then
    log ERROR "YAML frontmatter is empty: ${path}"
    return 1
  fi

  # Check variant field exists
  if ! echo "$frontmatter" | grep -q '^variant:'; then
    log ERROR "YAML frontmatter missing 'variant' field: ${path}"
    return 1
  fi

  # Check tasks field exists
  if ! echo "$frontmatter" | grep -q '^tasks:'; then
    log ERROR "YAML frontmatter missing 'tasks' field: ${path}"
    return 1
  fi

  # Check at least one task with desc and files
  if ! echo "$frontmatter" | grep -q '  - desc:'; then
    log ERROR "YAML frontmatter has no tasks with 'desc' field: ${path}"
    return 1
  fi

  if ! echo "$frontmatter" | grep -q '    files:'; then
    log ERROR "YAML frontmatter has no tasks with 'files' field: ${path}"
    return 1
  fi

  log INFO "YAML frontmatter validated: ${path}"
  return 0
}

# ============================================================
# validate_justification()
# Checks decision body has justification referencing AGENTS.md.
# Usage: validate_justification <path>
# Returns: 0 if valid, 1 otherwise.
# ============================================================
validate_justification() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Decision file is empty or missing: ${path}"
    return 1
  fi

  # Check for justification section
  if ! grep -qi 'justification' "$path"; then
    log ERROR "Decision missing justification section: ${path}"
    return 1
  fi

  # Check for AGENTS.md reference (vision alignment)
  if ! grep -qi 'AGENTS\|vision\|project goal' "$path"; then
    log ERROR "Justification does not reference project vision (AGENTS.md): ${path}"
    return 1
  fi

  log INFO "Justification validated: ${path}"
  return 0
}

# ============================================================
# build_task_prompt()
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local spec_path="$2"
  local revised_path="$3"

  cat <<EOF
Issue #${issue_number}

Revised plan artifact: ${revised_path}
Specification artifact: ${spec_path}

Instructions:
1. Read ${revised_path} (the Reviewer's revised plan from Stage 3).
2. Read ${spec_path} (the specification from Stage 1).
3. Read AGENTS.md for project vision and goals.
4. Create .sdlc/pipeline/${issue_number}/04-decision.md:
   - Start with YAML frontmatter containing 'variant' and 'tasks' fields.
   - Tasks must have 'desc' (string) and 'files' (array of paths).
   - Tasks ordered by dependency (blocking first).
   - Follow with justification referencing: technical fit, vision alignment
     (cite AGENTS.md), complexity trade-off.
5. Do NOT implement code or modify any files other than 04-decision.md.
EOF
}

# ============================================================
# main()
# ============================================================
main() {
  local issue_number="${1:-}"

  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-4-architect.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local spec_path="${pipeline_dir}/01-spec.md"
  local revised_path="${pipeline_dir}/03-revised-plan.md"
  local decision_path="${pipeline_dir}/04-decision.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}.json"
  local allowed_paths=(
    ".sdlc/pipeline/${issue_number}/"
  )

  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 4: Architect — Issue #${issue_number} ==="

  if ! validate_artifact "$spec_path"; then
    log ERROR "Stage 1 artifact missing: ${spec_path}"
    report_status "$issue_number" "Stage 4 (Architect): FAILED — missing 01-spec.md"
    exit 1
  fi
  if ! validate_artifact "$revised_path"; then
    log ERROR "Stage 3 artifact missing: ${revised_path}"
    report_status "$issue_number" "Stage 4 (Architect): FAILED — missing 03-revised-plan.md"
    exit 1
  fi

  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number" "$spec_path" "$revised_path")

  report_status "$issue_number" "Stage 4 (Architect): started"

  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$decision_path")
  echo "$output" > "$log_json"

  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_yaml_frontmatter "$decision_path" \
     || ! validate_justification "$decision_path"; do

    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: decision validation failed"
      report_status "$issue_number" "Stage 4 (Architect): FAILED — validation failed after ${max_cont} continuations"
      exit 1
    fi

    (( cont++ ))
    local error_msg=""
    if ! validate_yaml_frontmatter "$decision_path" 2>/dev/null; then
      error_msg="04-decision.md must start with YAML frontmatter containing 'variant' and 'tasks' fields. Each task needs 'desc' and 'files'."
    fi
    if ! validate_justification "$decision_path" 2>/dev/null; then
      error_msg="${error_msg} Justification must reference project vision (AGENTS.md)."
    fi

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix the issues in 04-decision.md." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  if ! safety_check_diff "${allowed_paths[@]}"; then
    log ERROR "Safety check failed"
    report_status "$issue_number" "Stage 4 (Architect): FAILED — safety check failed"
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
    "sdlc(architect): ${issue_number} — decision and task breakdown" \
    "$decision_path" \
    "$log_json"

  report_status "$issue_number" "Stage 4 (Architect): completed"
  log INFO "=== Stage 4: Architect — completed ==="
}

if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
