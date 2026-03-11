#!/usr/bin/env bash
set -euo pipefail

# hitl-check.sh — Poll GitHub issue for human reply after HITL marker.
# Called by engine via defaults.hitl.check_script.
# Args: --run-dir DIR --issue-source PATH --run-id ID --node-id ID --bot-login LOGIN
# Exit 0 + body on stdout = reply found. Exit 1 = no reply yet.

RUN_DIR="" ISSUE_SOURCE="" RUN_ID="" NODE_ID="" BOT_LOGIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-dir)       RUN_DIR="$2"; shift 2 ;;
    --issue-source)  ISSUE_SOURCE="$2"; shift 2 ;;
    --run-id)        RUN_ID="$2"; shift 2 ;;
    --node-id)       NODE_ID="$2"; shift 2 ;;
    --bot-login)     BOT_LOGIN="$2"; shift 2 ;;
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

MARKER="<!-- hitl:${RUN_ID}:${NODE_ID} -->"

# Fetch all comments (--paginate emits one array per page; -s merges)
COMMENTS=$(gh api "repos/${REPO}/issues/${ISSUE}/comments" --paginate | jq -s 'add // []')

# Find the marker comment's index, then first subsequent non-bot comment
REPLY=$(echo "$COMMENTS" | jq -r --arg marker "$MARKER" --arg bot "$BOT_LOGIN" '
  # Find index of comment containing the marker
  (to_entries | map(select(.value.body | contains($marker))) | last | .key) as $marker_idx |
  if $marker_idx == null then
    null
  else
    # Find first comment after marker where user is not the bot
    [to_entries[] | select(.key > $marker_idx) | select(.value.user.login != $bot)] |
    first | .value.body // null
  end
')

if [[ "$REPLY" != "null" && -n "$REPLY" ]]; then
  echo "$REPLY"
  exit 0
else
  exit 1
fi
