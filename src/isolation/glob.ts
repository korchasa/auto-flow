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
