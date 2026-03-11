#!/usr/bin/env bash
set -euo pipefail

# hitl-ask.sh — Render HITL question JSON → markdown, post to GitHub issue.
# Called by engine via defaults.hitl.ask_script.
# Args: --run-dir DIR --issue-source PATH --run-id ID --node-id ID --question-json JSON

RUN_DIR="" ISSUE_SOURCE="" RUN_ID="" NODE_ID="" QUESTION_JSON=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)       RUN_DIR="$2"; shift 2 ;;
    --issue-source)  ISSUE_SOURCE="$2"; shift 2 ;;
    --run-id)        RUN_ID="$2"; shift 2 ;;
    --node-id)       NODE_ID="$2"; shift 2 ;;
    --question-json) QUESTION_JSON="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# Extract issue number from PM artifact frontmatter
if [[ -z "$ISSUE_SOURCE" || -z "$RUN_DIR" ]]; then
  echo "ERROR: --run-dir and --issue-source are required" >&2
  exit 1
fi

ISSUE=$(yq '.issue' "$RUN_DIR/$ISSUE_SOURCE" 2>/dev/null || true)
if [[ -z "$ISSUE" || "$ISSUE" == "null" ]]; then
  echo "ERROR: could not extract issue number from $RUN_DIR/$ISSUE_SOURCE" >&2
  exit 1
fi

# Auto-detect repo
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)

if [[ -z "$QUESTION_JSON" ]]; then
  echo "ERROR: --question-json is required" >&2
  exit 1
fi

# Render markdown from question JSON
QUESTION=$(echo "$QUESTION_JSON" | jq -r '.question // "No question provided"')
HEADER=$(echo "$QUESTION_JSON" | jq -r '.header // empty')

MARKDOWN=""

# Header
if [[ -n "$HEADER" ]]; then
  MARKDOWN="**Agent \`${NODE_ID}\` is waiting for your input — ${HEADER}**"
else
  MARKDOWN="**Agent \`${NODE_ID}\` is waiting for your input**"
fi

MARKDOWN="${MARKDOWN}

> ${QUESTION}
"

# Render options if present
OPTIONS_COUNT=$(echo "$QUESTION_JSON" | jq -r '.options | length // 0')
if [[ "$OPTIONS_COUNT" -gt 0 ]]; then
  MARKDOWN="${MARKDOWN}
"
  for i in $(seq 0 $((OPTIONS_COUNT - 1))); do
    LABEL=$(echo "$QUESTION_JSON" | jq -r ".options[$i].label")
    DESC=$(echo "$QUESTION_JSON" | jq -r ".options[$i].description // empty")
    if [[ -n "$DESC" ]]; then
      MARKDOWN="${MARKDOWN}${i+1}. **${LABEL}** — ${DESC}
"
    else
      MARKDOWN="${MARKDOWN}$((i + 1)). **${LABEL}**
"
    fi
  done
fi

# Footer with marker
MARKDOWN="${MARKDOWN}
_Reply with a comment below._
<!-- hitl:${RUN_ID}:${NODE_ID} -->"

# Post to GitHub issue
if [[ -n "$REPO" ]]; then
  gh issue comment "$ISSUE" --repo "$REPO" --body "$MARKDOWN"
else
  gh issue comment "$ISSUE" --body "$MARKDOWN"
fi
