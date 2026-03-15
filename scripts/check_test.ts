import { assertEquals } from "@std/assert";
import { checkArgs, printUsage, validateAgentListContent } from "./check.ts";

// --- printUsage ---

Deno.test("printUsage — contains Usage and deno task check", () => {
  const text = printUsage();
  assertEquals(text.includes("Usage:"), true);
  assertEquals(text.includes("deno task check"), true);
});

Deno.test("printUsage — mentions checks performed", () => {
  const text = printUsage();
  assertEquals(text.includes("Formatting check"), true);
  assertEquals(text.includes("Linting"), true);
  assertEquals(text.includes("Tests"), true);
  assertEquals(text.includes("Pipeline integrity"), true);
  assertEquals(text.includes("AGENTS.md agent list accuracy"), true);
  assertEquals(text.includes("Comment marker scan"), true);
});

// --- checkArgs ---

Deno.test("checkArgs — --help returns usage text with code 0", () => {
  const result = checkArgs(["--help"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task check"), true);
});

Deno.test("checkArgs — -h returns usage text with code 0", () => {
  const result = checkArgs(["-h"]);
  assertEquals(result?.code, 0);
  assertEquals(result?.text.includes("deno task check"), true);
});

Deno.test("checkArgs — unknown arg returns error string with code 1", () => {
  const result = checkArgs(["--verbose"]);
  assertEquals(result?.code, 1);
  assertEquals(result?.text.includes("Unknown argument: --verbose"), true);
  assertEquals(result?.text.includes("--help"), true);
});

Deno.test("checkArgs — unknown positional arg returns error with code 1", () => {
  const result = checkArgs(["somefile"]);
  assertEquals(result?.code, 1);
  assertEquals(result?.text.includes("Unknown argument: somefile"), true);
});

Deno.test("checkArgs — empty args returns null (ok)", () => {
  const result = checkArgs([]);
  assertEquals(result, null);
});

// --- validateAgentListContent ---

Deno.test("validateAgentListContent — valid 7-agent content passes", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Tech Lead Review, Meta-Agent\n\n## Next Section\n";
  const errors = validateAgentListContent(content);
  assertEquals(errors, []);
});

Deno.test("validateAgentListContent — missing agent fails", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Meta-Agent\n\n## Next\n";
  const errors = validateAgentListContent(content);
  assertEquals(
    errors.some((e: string) => e.includes("Tech Lead Review")),
    true,
  );
});

Deno.test("validateAgentListContent — deprecated agent Presenter fails", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Tech Lead Review, Meta-Agent, Presenter\n\n## Next\n";
  const errors = validateAgentListContent(content);
  assertEquals(errors.some((e: string) => e.includes("Presenter")), true);
});

Deno.test("validateAgentListContent — deprecated agent Reviewer fails", () => {
  const content =
    "## Project Vision\nPM, Architect, Tech Lead, Developer, QA, Tech Lead Review, Meta-Agent\n\nReviewer also exists\n## Next\n";
  const errors = validateAgentListContent(content);
  assertEquals(errors.some((e: string) => e.includes("Reviewer")), true);
});

Deno.test("validateAgentListContent — missing Project Vision section fails", () => {
  const content = "## Some Section\ncontent\n";
  const errors = validateAgentListContent(content);
  assertEquals(
    errors.some((e: string) => e.includes("Project Vision")),
    true,
  );
});

Deno.test("validateAgentListContent — real AGENTS.md passes", async () => {
  const content = await Deno.readTextFile("AGENTS.md");
  const errors = validateAgentListContent(content);
  assertEquals(errors, []);
});
