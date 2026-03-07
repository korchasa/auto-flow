#!/usr/bin/env bash
# stage-1-pm.sh — Stage 1: Project Manager (Specification).
# Reads GitHub Issue, produces 01-spec.md, updates SRS.
# See: requirements.md FR-2, FR-8, FR-10, FR-14.
#
# Usage: stage-1-pm.sh <issue-number>
#
# When sourced with --source-only, only defines functions (for testing).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=lib.sh disable=SC1091
source "$SCRIPT_DIR/lib.sh"

# ============================================================
# Constants
# ============================================================
STAGE_NAME="stage-1-pm"
AGENT_PROMPT="$REPO_ROOT/.sdlc/agents/pm.md"

# SDS-level heading patterns (case-insensitive grep -iE)
SDS_PATTERNS='## (Data Structures|Algorithms|Class Diagram|API Schema|Sequence Diagram|Component Design|Database|ERD|Migration|Implementation Details)'

# Required sections in 01-spec.md (FR-2 quality metrics)
REQUIRED_SECTIONS=(
  "Problem Statement"
  "Affected Requirements"
  "SRS Changes"
  "Scope Boundaries"
)

# ============================================================
# validate_spec_sections()
# Checks that 01-spec.md contains all 4 required H2 sections.
# Usage: validate_spec_sections <path>
# Returns: 0 if all present, 1 if any missing.
# ============================================================
validate_spec_sections() {
  local path="$1"

  if [[ ! -s "$path" ]]; then
    log ERROR "Spec file is empty or missing: ${path}"
    return 1
  fi

  local missing=()
  for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -q "## ${section}" "$path"; then
      missing+=("$section")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    log ERROR "Spec missing sections: ${missing[*]}"
    return 1
  fi

  log INFO "Spec sections validated: ${path}"
  return 0
}

# ============================================================
# validate_no_sds_details()
# Ensures spec does not contain SDS-level headings.
# Usage: validate_no_sds_details <path>
# Returns: 0 if clean, 1 if SDS content detected.
# ============================================================
validate_no_sds_details() {
  local path="$1"

  if grep -qiE "$SDS_PATTERNS" "$path"; then
    log ERROR "SDS-level details detected in spec: ${path}"
    return 1
  fi

  log INFO "No SDS-level details: ${path}"
  return 0
}

# ============================================================
# build_task_prompt()
# Constructs the task prompt from issue data.
# Usage: build_task_prompt <issue-number> <title> <body>
# Outputs: prompt string to stdout.
# ============================================================
build_task_prompt() {
  local issue_number="$1"
  local title="$2"
  local body="$3"

  cat <<EOF
Issue #${issue_number}: ${title}

--- Issue Body ---
${body}
--- End Issue Body ---

Instructions:
1. Read documents/requirements.md, documents/design.md, and AGENTS.md.
2. Analyze the issue above.
3. Update documents/requirements.md with new/modified requirements.
4. Create .sdlc/pipeline/${issue_number}/01-spec.md with all four required sections:
   - Problem Statement
   - Affected Requirements
   - SRS Changes
   - Scope Boundaries
5. Do NOT include implementation details (data structures, algorithms, etc.).
EOF
}

# ============================================================
# main()
# Orchestrates Stage 1: PM agent invocation with validation.
# ============================================================
main() {
  local issue_number="${1:-}"

  # Validate argument
  if [[ -z "$issue_number" ]]; then
    log ERROR "Usage: stage-1-pm.sh <issue-number>"
    exit 1
  fi

  if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
    log ERROR "Issue number must be numeric: ${issue_number}"
    exit 1
  fi

  local pipeline_dir="$REPO_ROOT/.sdlc/pipeline/${issue_number}"
  local spec_path="${pipeline_dir}/01-spec.md"
  local log_dir="${pipeline_dir}/logs"
  local log_json="${log_dir}/${STAGE_NAME}.json"
  local allowed_paths=(
    "documents/requirements.md"
    ".sdlc/pipeline/${issue_number}/"
  )

  # Create pipeline directories
  mkdir -p "$pipeline_dir" "$log_dir"

  log INFO "=== Stage 1: PM — Issue #${issue_number} ==="

  # Fetch issue data from GitHub
  log INFO "Fetching issue #${issue_number} from GitHub"
  local issue_json
  issue_json=$(retry_with_backoff gh issue view "$issue_number" --json title,body)
  local issue_title
  issue_title=$(echo "$issue_json" | jq -r '.title')
  local issue_body
  issue_body=$(echo "$issue_json" | jq -r '.body')

  # Build task prompt
  local task_prompt
  task_prompt=$(build_task_prompt "$issue_number" "$issue_title" "$issue_body")

  # Report start
  report_status "$issue_number" "Stage 1 (PM): started"

  # Run agent with continuation loop for artifact validation
  local output
  output=$(continuation_loop "$AGENT_PROMPT" "$task_prompt" "$spec_path")
  echo "$output" > "$log_json"

  # Post-agent validation: check 4 required sections
  local session_id
  session_id=$(echo "$output" | jq -r '.session_id // empty')
  local cont=0
  local max_cont="${SDLC_MAX_CONTINUATIONS}"

  while ! validate_spec_sections "$spec_path" || ! validate_no_sds_details "$spec_path"; do
    if (( cont >= max_cont )); then
      log ERROR "Continuation limit reached: spec validation failed"
      report_status "$issue_number" "Stage 1 (PM): FAILED — spec validation failed after ${max_cont} continuations"
      exit 1
    fi

    (( cont++ ))
    local error_msg=""
    if ! validate_spec_sections "$spec_path" 2>/dev/null; then
      error_msg="Spec is missing required sections. Must have: ${REQUIRED_SECTIONS[*]}."
    fi
    if ! validate_no_sds_details "$spec_path" 2>/dev/null; then
      error_msg="${error_msg} Spec contains SDS-level details (implementation, data structures, algorithms). Remove them."
    fi

    log WARN "Continuation ${cont}/${max_cont}: ${error_msg}"
    output=$(retry_with_backoff claude \
      --resume "$session_id" \
      -p "Validation failed: ${error_msg} Fix the issues in 01-spec.md." \
      --output-format json)
    echo "$output" > "$log_json"
  done

  # Safety check: no out-of-scope modifications or secrets
  if ! safety_check_diff "${allowed_paths[@]}"; then
    log ERROR "Safety check failed: out-of-scope changes or secrets detected"
    report_status "$issue_number" "Stage 1 (PM): FAILED — safety check failed"
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
    "sdlc(pm): ${issue_number} — specification" \
    "$spec_path" \
    "$log_json" \
    "documents/requirements.md"

  # Report success
  report_status "$issue_number" "Stage 1 (PM): completed"
  log INFO "=== Stage 1: PM — completed ==="
}

# Allow sourcing for testing without executing main
if [[ "${1:-}" != "--source-only" ]]; then
  main "$@"
fi
