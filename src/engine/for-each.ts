/**
 * @module
 * Data-driven fan-out (FR-E90): expand one node into one execution per item of
 * a list produced by an earlier node.
 * Entry points: {@link parseForEachSource}, {@link slugifyKey},
 * {@link resolveForEachItems}.
 */

import type { ForEachConfig, NodeConfig, TemplateContext } from "../types.ts";
import { interpolate } from "../config/template.ts";
import { workPath } from "../state/state.ts";

/** One expansion of a `for_each` node. */
export interface ForEachItem {
  /** Zero-based position in the source list. */
  index: number;
  /** The item's own text. */
  value: string;
  /** Artifact-directory name for this item (`key_by`). */
  key: string;
}

/**
 * Parse a `for_each` source file into items.
 *
 * Two accepted shapes, distinguished by the first non-space character:
 * a JSON array of strings or numbers, or one item per non-empty line. A
 * document that *looks* like JSON but does not parse is an error rather than a
 * single-line item — silently treating a broken array as one long string would
 * fan out to exactly one nonsense execution.
 */
export function parseForEachSource(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `for_each source starts with '[' but is not valid JSON: ${
          (err as Error).message
        }`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        "for_each source must be a JSON array or newline-separated items",
      );
    }
    return parsed.map((entry, i) => {
      if (typeof entry === "string") return entry;
      if (typeof entry === "number") return String(entry);
      throw new Error(
        `for_each source items must be strings or numbers (item ${i} is ${typeof entry})`,
      );
    });
  }

  if (trimmed.startsWith("{")) {
    throw new Error(
      "for_each source must be a JSON array or newline-separated items",
    );
  }

  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Turn an item's text into a filesystem-safe directory name.
 *
 * Path separators, dot segments and whitespace runs collapse to single dashes,
 * so an item that is a path cannot escape its node's artifact directory. A
 * value that collapses to nothing falls back to `item`; the caller
 * de-duplicates.
 */
export function slugifyKey(value: string): string {
  const slug = value
    .replace(/\.\.+/g, ".")
    .split(/[/\\]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== ".")
    .join("-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "item" : slug;
}

/**
 * Read a node's `for_each` source and build its item list.
 *
 * The source path is interpolated first, so it can point at a predecessor's
 * artifact (`{{input.plan}}/files.txt`), then resolved against the run's
 * working directory like every other engine-side path.
 */
export async function resolveForEachItems(
  node: NodeConfig,
  ctx: TemplateContext,
  cwd?: string,
): Promise<ForEachItem[]> {
  const cfg = node.for_each;
  if (!cfg) throw new Error("Node has no 'for_each' block");

  const base = cwd ?? ctx.workDir;
  const resolved = interpolate(cfg.source, ctx, base);
  const path = resolved.startsWith("/") ? resolved : workPath(base, resolved);

  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    throw new Error(
      `for_each source not readable: ${resolved} (${(err as Error).message})`,
    );
  }

  return assignKeys(parseForEachSource(text), cfg);
}

/**
 * Derive the template context for one item of a fan-out.
 *
 * `node_dir` gains the item's key as a segment, so every item writes into its
 * own artifact directory instead of overwriting the previous item's output.
 * The value stays workDir-relative, as the `TemplateContext` contract requires
 * (FR-E52) — this is path composition, not a filesystem access.
 */
export function itemContext(
  ctx: TemplateContext,
  item: ForEachItem,
): TemplateContext {
  return {
    ...ctx,
    node_dir: `${ctx.node_dir}/${item.key}`,
    each: { index: item.index, value: item.value, key: item.key },
  };
}

/** Create an item's artifact directory before its execution writes into it. */
export async function ensureItemDir(
  ctx: TemplateContext,
  cwd?: string,
): Promise<void> {
  await Deno.mkdir(workPath(cwd ?? ctx.workDir, ctx.node_dir), {
    recursive: true,
  });
}

/** Attach an artifact-directory key to every item, keeping keys unique. */
export function assignKeys(
  values: string[],
  cfg: ForEachConfig,
): ForEachItem[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    if (cfg.key_by !== "value") return { index, value, key: String(index) };
    const base = slugifyKey(value);
    // Two items can slugify to the same name ("a/b" and "a-b"). Suffixing the
    // duplicate keeps each item's artifacts in its own directory instead of
    // letting the later one overwrite the earlier one's output.
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { index, value, key: count === 0 ? base : `${base}-${count}` };
  });
}
