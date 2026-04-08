/**
 * @module
 * Output artifact validation for workflow nodes.
 * Supports five rule types: file_exists, file_not_empty, contains_section,
 * custom_script, and frontmatter_field.
 * Entry point: {@link runValidations}.
 */

import type { TemplateContext, ValidationRule } from "./types.ts";
import { interpolate } from "./template.ts";

/** Result of running a validation rule. */
export interface ValidationResult {
  /** The validation rule that was evaluated. */
  rule: ValidationRule;
  /** Whether the validation check passed. */
  passed: boolean;
  /** Human-readable outcome description. */
  message: string;
}

/** Run all validation rules for a node. Returns results for each rule.
 * @param cwd — working directory for custom_script execution. */
export async function runValidations(
  rules: ValidationRule[],
  ctx: TemplateContext,
  cwd?: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const rule of rules) {
    results.push(await runSingleValidation(rule, ctx, cwd));
  }
  return results;
}

/** Check if all validation results passed. */
export function allPassed(results: ValidationResult[]): boolean {
  return results.every((r) => r.passed);
}

/** Format validation failures into a human-readable string. */
export function formatFailures(results: ValidationResult[]): string {
  return results
    .filter((r) => !r.passed)
    .map((r) => `- [${r.rule.type}] ${r.message}`)
    .join("\n");
}

async function runSingleValidation(
  rule: ValidationRule,
  ctx: TemplateContext,
  cwd?: string,
): Promise<ValidationResult> {
  const resolvedPath = interpolate(rule.path, ctx);

  switch (rule.type) {
    case "file_exists":
      return await checkFileExists(rule, resolvedPath);
    case "file_not_empty":
      return await checkFileNotEmpty(rule, resolvedPath);
    case "contains_section":
      return await checkContainsSection(rule, resolvedPath);
    case "custom_script":
      return await checkCustomScript(rule, resolvedPath, cwd);
    case "frontmatter_field":
      return await checkFrontmatterField(rule, resolvedPath);
    case "artifact":
      return await checkArtifact(rule, resolvedPath);
    default:
      return {
        rule,
        passed: false,
        message: `Unknown validation type: ${(rule as ValidationRule).type}`,
      };
  }
}

async function checkFileExists(
  rule: ValidationRule,
  path: string,
): Promise<ValidationResult> {
  try {
    await Deno.stat(path);
    return { rule, passed: true, message: `File exists: ${path}` };
  } catch {
    return { rule, passed: false, message: `File not found: ${path}` };
  }
}

async function checkFileNotEmpty(
  rule: ValidationRule,
  path: string,
): Promise<ValidationResult> {
  try {
    const stat = await Deno.stat(path);
    if (stat.size === 0) {
      return { rule, passed: false, message: `File is empty: ${path}` };
    }
    return {
      rule,
      passed: true,
      message: `File is non-empty: ${path} (${stat.size} bytes)`,
    };
  } catch {
    return { rule, passed: false, message: `File not found: ${path}` };
  }
}

async function checkContainsSection(
  rule: ValidationRule,
  path: string,
): Promise<ValidationResult> {
  const section = rule.value;
  if (!section) {
    return {
      rule,
      passed: false,
      message: `contains_section rule requires 'value' (section heading)`,
    };
  }

  try {
    const content = await Deno.readTextFile(path);
    // Match markdown heading with the section name
    const pattern = new RegExp(`^#{1,6}\\s+${escapeRegex(section)}`, "m");
    if (pattern.test(content)) {
      return {
        rule,
        passed: true,
        message: `Section '${section}' found in ${path}`,
      };
    }
    return {
      rule,
      passed: false,
      message: `Section '${section}' not found in ${path}`,
    };
  } catch {
    return { rule, passed: false, message: `File not found: ${path}` };
  }
}

async function checkCustomScript(
  rule: ValidationRule,
  scriptPath: string,
  cwd?: string,
): Promise<ValidationResult> {
  try {
    const cmd = new Deno.Command("sh", {
      args: ["-c", scriptPath],
      stdout: "piped",
      stderr: "piped",
      ...(cwd ? { cwd } : {}),
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();

    if (output.success) {
      return {
        rule,
        passed: true,
        message: `Script passed: ${scriptPath}${stdout ? ` (${stdout})` : ""}`,
      };
    }
    return {
      rule,
      passed: false,
      message: `Script failed: ${scriptPath}${stderr ? `\n${stderr}` : ""}`,
    };
  } catch (err) {
    return {
      rule,
      passed: false,
      message: `Script execution error: ${scriptPath} — ${
        (err as Error).message
      }`,
    };
  }
}

/**
 * Validate that a YAML frontmatter field in an artifact file has an expected value.
 *
 * Why regex over a full YAML parser: agent output artifacts contain valid YAML
 * frontmatter (between `---` delimiters) but potentially invalid YAML in the
 * document body (e.g. unquoted colons in markdown text). Parsing the whole
 * document would throw on a valid artifact. We extract only the frontmatter
 * block via regex and apply a second simple key:value regex — robust enough
 * for single-level scalar fields without risking spurious parse failures.
 */
async function checkFrontmatterField(
  rule: ValidationRule,
  path: string,
): Promise<ValidationResult> {
  if (!rule.field) {
    return {
      rule,
      passed: false,
      message: `frontmatter_field rule requires 'field' property`,
    };
  }

  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    return { rule, passed: false, message: `File not found: ${path}` };
  }

  // Extract YAML frontmatter between --- delimiters
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return {
      rule,
      passed: false,
      message: `No YAML frontmatter found in ${path}`,
    };
  }

  // Parse the target field from frontmatter (simple key: value parsing)
  const fieldPattern = new RegExp(
    `^${escapeRegex(rule.field)}:\\s*(.+)$`,
    "m",
  );
  const fieldMatch = fmMatch[1].match(fieldPattern);
  if (!fieldMatch) {
    return {
      rule,
      passed: false,
      message: `Field '${rule.field}' not found in frontmatter of ${path}`,
    };
  }

  const value = fieldMatch[1].trim();

  // If allowed values are specified, check against them
  if (rule.allowed && rule.allowed.length > 0) {
    if (!rule.allowed.includes(value)) {
      return {
        rule,
        passed: false,
        message:
          `Field '${rule.field}' has value '${value}', not in allowed set [${
            rule.allowed.join(", ")
          }] in ${path}`,
      };
    }
  }

  return {
    rule,
    passed: true,
    message: `Field '${rule.field}' = '${value}' in ${path}`,
  };
}

/**
 * Check that a file exists, is non-empty, contains all required markdown
 * sections, and has all required frontmatter fields with non-empty values.
 *
 * Fail-fast order: absent file → empty file → missing sections → missing/empty
 * fields (each category collected into one aggregate error so the agent sees
 * all gaps in a single continuation).
 */
async function checkArtifact(
  rule: ValidationRule,
  path: string,
): Promise<ValidationResult> {
  const sections = rule.sections ?? [];
  const fields = rule.fields ?? [];

  try {
    await Deno.stat(path);
  } catch {
    return { rule, passed: false, message: `File not found: ${path}` };
  }

  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    return { rule, passed: false, message: `File not found: ${path}` };
  }

  if (content.length === 0) {
    return { rule, passed: false, message: `File is empty: ${path}` };
  }

  const missing: string[] = [];
  for (const section of sections) {
    const pattern = new RegExp(`^#{1,6}\\s+${escapeRegex(section)}`, "m");
    if (!pattern.test(content)) {
      missing.push(section);
    }
  }

  if (missing.length > 0) {
    return {
      rule,
      passed: false,
      message: `Missing sections in ${path}: ${
        missing.map((s) => `'${s}'`).join(", ")
      }`,
    };
  }

  // Check frontmatter field presence if fields are specified (FR-E38)
  if (fields.length > 0) {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return {
        rule,
        passed: false,
        message: `No YAML frontmatter found in ${path}`,
      };
    }
    const fm = fmMatch[1];
    const missingFields: string[] = [];
    for (const fieldKey of fields) {
      const fieldPattern = new RegExp(
        `^${escapeRegex(fieldKey)}:\\s*(.*)$`,
        "m",
      );
      const fieldMatch = fm.match(fieldPattern);
      if (!fieldMatch || !fieldMatch[1].trim()) {
        missingFields.push(fieldKey);
      }
    }
    if (missingFields.length > 0) {
      return {
        rule,
        passed: false,
        message: `Missing or empty frontmatter fields in ${path}: ${
          missingFields.map((f) => `'${f}'`).join(", ")
        }`,
      };
    }
  }

  return { rule, passed: true, message: `Artifact validated: ${path}` };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
