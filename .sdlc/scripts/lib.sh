#!/usr/bin/env bash
# lib.sh — Shared functions for SDLC pipeline stage scripts.
# See: documents/design.md §3.3, documents/requirements.md FR-8, FR-12, FR-15.
set -euo pipefail

# ============================================================
# Configuration defaults (FR-15)
# ============================================================
: "${SDLC_MAX_CONTINUATIONS:=3}"
: "${SDLC_MAX_QA_ITERATIONS:=3}"
: "${SDLC_STAGE_TIMEOUT_MINUTES:=30}"
: "${SDLC_RETRY_MAX_ATTEMPTS:=3}"
: "${SDLC_RETRY_INITIAL_DELAY:=5}"
: "${SDLC_RETRY_BACKOFF_MULTIPLIER:=2}"

export SDLC_MAX_CONTINUATIONS
export SDLC_MAX_QA_ITERATIONS
export SDLC_STAGE_TIMEOUT_MINUTES

# ============================================================
# log()
# Outputs timestamped, leveled log message to stderr.
# Usage: log LEVEL "message"
# ============================================================
log() {
  local level="$1"
  shift
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "${timestamp} [${level}] $*" >&2
}

# ============================================================
# validate_artifact()
# Checks that a file exists and is non-empty.
# Usage: validate_artifact "/path/to/file.md"
# Returns: 0 on success, 1 on failure.
# ============================================================
validate_artifact() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    log ERROR "Artifact not found: ${path}"
    return 1
  fi
  if [[ ! -s "$path" ]]; then
    log ERROR "Artifact is empty: ${path}"
    return 1
  fi
  log INFO "Artifact validated: ${path}"
  return 0
}

# ============================================================
# retry_with_backoff()
# Generic retry wrapper for external CLI calls.
# Max attempts, initial delay, 2x backoff. Retries on non-zero exit.
# Usage: retry_with_backoff command [args...]
# ============================================================
retry_with_backoff() {
  local max_attempts="${SDLC_RETRY_MAX_ATTEMPTS}"
  local delay="${SDLC_RETRY_INITIAL_DELAY}"
  local multiplier="${SDLC_RETRY_BACKOFF_MULTIPLIER}"
  local attempt=1

  while true; do
    if "$@"; then
      return 0
    fi

    if (( attempt >= max_attempts )); then
      log ERROR "Command failed after ${max_attempts} attempts: $*"
      return 1
    fi

    log WARN "Attempt ${attempt}/${max_attempts} failed, retrying in ${delay}s: $*"
    sleep "$delay"
    delay=$(echo "$delay * $multiplier" | bc)
    (( attempt++ ))
  done
}

# ============================================================
# run_agent()
# Invokes claude CLI with a role-specific prompt.
# Usage: run_agent <prompt-file> <task-prompt> [extra-args...]
# Returns: JSON output from claude CLI.
# ============================================================
run_agent() {
  local prompt_file="$1"
  local task_prompt="$2"
  shift 2

  log INFO "Running agent with prompt: ${prompt_file}"
  retry_with_backoff claude \
    -p "$task_prompt" \
    --append-system-prompt-file "$prompt_file" \
    --output-format json \
    "$@"
}

# ============================================================
# continuation_loop()
# Invokes agent, validates, resumes on failure (max N times).
# Usage: continuation_loop <prompt-file> <task-prompt> <artifact-path> [extra-args...]
# ============================================================
continuation_loop() {
  local prompt_file="$1"
  local task_prompt="$2"
  local artifact_path="$3"
  shift 3

  local max_cont="${SDLC_MAX_CONTINUATIONS}"
  local cont=0
  local session_id=""
  local output

  # Initial invocation
  output=$(run_agent "$prompt_file" "$task_prompt" "$@")
  session_id=$(echo "$output" | jq -r '.session_id // empty')

  while true; do
    if validate_artifact "$artifact_path"; then
      echo "$output"
      return 0
    fi

    if (( cont >= max_cont )); then
      log ERROR "Continuation limit (${max_cont}) reached for: ${artifact_path}"
      return 1
    fi

    (( cont++ ))
    log WARN "Continuation ${cont}/${max_cont}: artifact validation failed, resuming agent"

    if [[ -n "$session_id" ]]; then
      output=$(retry_with_backoff claude \
        --resume "$session_id" \
        -p "Validation failed: artifact ${artifact_path} is missing or empty. Fix the issue." \
        --output-format json)
    else
      log ERROR "No session_id available for --resume"
      return 1
    fi
  done
}

# ============================================================
# commit_artifacts()
# Stages files, commits with message, pushes to current branch.
# Usage: commit_artifacts "commit message" file1 [file2...]
# ============================================================
commit_artifacts() {
  local message="$1"
  shift
  local files=("$@")

  for f in "${files[@]}"; do
    git add "$f"
  done

  git commit -m "$message"

  local branch
  branch=$(git rev-parse --abbrev-ref HEAD)
  retry_with_backoff git push origin "$branch"

  log INFO "Committed and pushed: ${message}"
}

# ============================================================
# report_status()
# Posts a status comment on a GitHub issue.
# Usage: report_status <issue-number> "message"
# ============================================================
report_status() {
  local issue_number="$1"
  local message="$2"

  retry_with_backoff gh issue comment "$issue_number" --body "$message"
  log INFO "Status reported on issue #${issue_number}"
}

# ============================================================
# safety_check_diff()
# Checks git diff for out-of-scope modifications and secrets.
# Usage: safety_check_diff "allowed_path1" ["allowed_path2" ...]
# Returns: 0 if safe, 1 if violations found.
# ============================================================
safety_check_diff() {
  local -a allowed_paths=("$@")
  local violations=0

  # Get list of changed files (staged + unstaged)
  local changed_files
  changed_files=$(git diff --name-only HEAD 2>/dev/null || git diff --name-only) || true

  if [[ -z "$changed_files" ]]; then
    log INFO "No changes detected"
    return 0
  fi

  # Check for out-of-scope modifications
  local file
  for file in $changed_files; do
    local allowed=false
    local pattern
    for pattern in "${allowed_paths[@]}"; do
      if [[ "$file" == "$pattern"* ]] || [[ "$file" == "$pattern" ]]; then
        allowed=true
        break
      fi
    done
    if [[ "$allowed" == "false" ]]; then
      log ERROR "Out-of-scope modification: ${file}"
      violations=1
    fi
  done

  # Check for secret-like patterns in diff content
  local diff_content
  diff_content=$(git diff HEAD 2>/dev/null || git diff) || true

  if echo "$diff_content" | grep -qiE '(api[_-]?key|secret|token|password|credential)\s*[:=]\s*['\''"][^'\''"]{8,}'; then
    log ERROR "Potential secret detected in diff"
    violations=1
  fi

  if (( violations == 0 )); then
    log INFO "Safety check passed"
  fi

  return $violations
}
