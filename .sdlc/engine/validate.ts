import type { TemplateContext, ValidationRule } from "./types.ts";
import { interpolate } from "./template.ts";

/** Result of running a validation rule. */
export interface ValidationResult {
  rule: ValidationRule;
  passed: boolean;
  message: string;
}

/** Run all validation rules for a node. Returns results for each rule. */
export async function runValidations(
  rules: ValidationRule[],
  ctx: TemplateContext,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const rule of rules) {
    results.push(await runSingleValidation(rule, ctx));
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
      return await checkCustomScript(rule, resolvedPath);
    case "frontmatter_field":
      return await checkFrontmatterField(rule, resolvedPath);
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
): Promise<ValidationResult> {
  try {
    const cmd = new Deno.Command("sh", {
      args: ["-c", scriptPath],
      stdout: "piped",
      stderr: "piped",
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
          `Field '${rule.field}' has value '${value}', not in allowed set [${rule.allowed.join(", ")}] in ${path}`,
      };
    }
  }

  return {
    rule,
    passed: true,
    message: `Field '${rule.field}' = '${value}' in ${path}`,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
