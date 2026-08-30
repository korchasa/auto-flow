/**
 * @module
 * Shared glob matcher for isolation checks (`scope-check.ts`,
 * `guardrail.ts`, `memory-check.ts`). Single source of truth — the
 * implementation was previously triplicated across those modules.
 */

/**
 * Match a file path against a glob pattern.
 *
 * Supported syntax:
 * - `**` — matches any sequence of path segments (including none)
 * - `*` — matches any sequence of characters within a single path segment
 * - `?` — matches a single character (non-separator)
 * - All other characters match literally
 */
export function globMatch(pattern: string, filePath: string): boolean {
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    if (
      pattern[i] === "*" && i + 1 < pattern.length &&
      pattern[i + 1] === "*"
    ) {
      regexStr += ".*";
      i += 2;
      if (i < pattern.length && pattern[i] === "/") i++;
    } else if (pattern[i] === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      regexStr += "[^/]";
      i++;
    } else {
      regexStr += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`).test(filePath);
}

/**
 * Whether two glob patterns can match the same path (FR-E37).
 *
 * Conservative by construction: it reports an overlap unless it can prove the
 * two are disjoint. A false "they overlap" costs a workflow author one edit to
 * their `allowed_paths`; a false "they are disjoint" lets two branches edit the
 * same file in the same tree and lose one of the two edits silently.
 */
export function globsOverlap(a: string, b: string): boolean {
  const left = a.split("/");
  const right = b.split("/");
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    if (left[i] === "**" || right[i] === "**") return true;
    if (segmentsDisjoint(left[i], right[i])) return false;
  }
  // One pattern is a prefix of the other, or they agree segment for segment.
  // Both cases can match a common path, so neither is provably disjoint.
  return true;
}

/** True when two single path segments can never match the same text. */
function segmentsDisjoint(left: string, right: string): boolean {
  if (left === right) return false;
  const leftGlob = left.includes("*") || left.includes("?");
  const rightGlob = right.includes("*") || right.includes("?");
  if (!leftGlob && !rightGlob) return true;
  // A wildcard segment is only provably disjoint from a literal one when it
  // cannot match it; two wildcard segments are never proven disjoint here.
  if (leftGlob && rightGlob) return false;
  return leftGlob ? !segmentMatches(left, right) : !segmentMatches(right, left);
}

/** Match one glob segment against one literal segment. */
function segmentMatches(pattern: string, literal: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`).test(literal);
}
