import type { TemplateContext } from "./types.ts";

/**
 * Interpolates `{{var}}` placeholders in a template string using the provided context.
 *
 * Supported patterns:
 * - `{{node_dir}}`, `{{run_dir}}`, `{{run_id}}` — direct context fields
 * - `{{input.<node-id>}}` — predecessor node output directory
 * - `{{args.<key>}}` — CLI arguments
 * - `{{env.<key>}}` — environment variables
 * - `{{loop.iteration}}` — current loop iteration
 *
 * Unresolved placeholders throw an error (fail fast).
 */
export function interpolate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    const key = expr.trim();
    return resolve(key, ctx);
  });
}

function resolve(key: string, ctx: TemplateContext): string {
  // Direct fields
  if (key === "node_dir") return ctx.node_dir;
  if (key === "run_dir") return ctx.run_dir;
  if (key === "run_id") return ctx.run_id;

  // Dotted paths
  const dotIdx = key.indexOf(".");
  if (dotIdx === -1) {
    throw new Error(`Unknown template variable: {{${key}}}`);
  }

  const prefix = key.substring(0, dotIdx);
  const suffix = key.substring(dotIdx + 1);

  if (!suffix) {
    throw new Error(`Empty key after prefix in template variable: {{${key}}}`);
  }

  switch (prefix) {
    case "input":
      if (!(suffix in ctx.input)) {
        throw new Error(
          `Unknown input node in template variable: {{${key}}}. Available: ${
            Object.keys(ctx.input).join(", ") || "(none)"
          }`,
        );
      }
      return ctx.input[suffix];

    case "args":
      if (!(suffix in ctx.args)) {
        throw new Error(
          `Unknown CLI argument in template variable: {{${key}}}. Available: ${
            Object.keys(ctx.args).join(", ") || "(none)"
          }`,
        );
      }
      return ctx.args[suffix];

    case "env":
      if (!(suffix in ctx.env)) {
        throw new Error(
          `Unknown env variable in template variable: {{${key}}}. Available: ${
            Object.keys(ctx.env).join(", ") || "(none)"
          }`,
        );
      }
      return ctx.env[suffix];

    case "loop":
      if (suffix !== "iteration") {
        throw new Error(
          `Unknown loop property in template variable: {{${key}}}. Only 'loop.iteration' is supported.`,
        );
      }
      if (!ctx.loop) {
        throw new Error(
          `Template variable {{loop.iteration}} used outside a loop context.`,
        );
      }
      return String(ctx.loop.iteration);

    default:
      throw new Error(`Unknown template variable prefix: {{${key}}}`);
  }
}
