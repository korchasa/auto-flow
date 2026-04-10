/**
 * @module
 * Barrel re-export for `deno doc --lint` entry point. Not imported by runtime code.
 */

export type {
  ClaudeCliOutput,
  EngineOptions,
  ErrorCategory,
  HitlConfig,
  HumanInputOption,
  HumanInputRequest,
  NodeConfig,
  NodeSettings,
  NodeState,
  NodeStatus,
  PermissionDenial,
  PermissionMode,
  RunState,
  RuntimeId,
  TemplateContext,
  ValidationRule,
  Verbosity,
  WorkflowConfig,
  WorkflowDefaults,
} from "./types.ts";

export { interpolate } from "./template.ts";
export {
  DEFAULT_SETTINGS,
  extractWorktreeDisabled,
  loadConfig,
  parseConfig,
} from "./config.ts";
export { buildLevels, buildLoopBodyOrder } from "./dag.ts";
export type { ExecutionLevels } from "./dag.ts";
export { allPassed, formatFailures, runValidations } from "./validate.ts";
export type { ValidationResult } from "./validate.ts";
export {
  clearPhaseRegistry,
  createRunState,
  generateRunId,
  getNodeDir,
  getPhaseForNode,
  getRunDir,
  getStatePath,
  loadState,
  saveState,
  setPhaseRegistry,
} from "./state.ts";
export { runAgent } from "./agent.ts";
export type { AgentResult, AgentRunOptions } from "./agent.ts";
export type { InvokeOptions } from "./claude-process.ts";
export { getRuntimeAdapter, resolveRuntimeConfig } from "./runtime/index.ts";
export type {
  ResolvedRuntimeConfig,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeInvokeOptions,
  RuntimeInvokeResult,
} from "./runtime/types.ts";
export { detectHitlRequest, runHitlLoop } from "./hitl.ts";
export type {
  ClaudeRunner,
  HitlQuestion,
  HitlRunOptions,
  ScriptRunner,
} from "./hitl.ts";
export { markNodeWaiting } from "./state.ts";
export { saveAgentLog } from "./log.ts";
export { extractFrontmatterField, runLoop } from "./loop.ts";
export type { LoopResult, LoopRunOptions } from "./loop.ts";
export {
  buildOpenCodeArgs,
  extractOpenCodeOutput,
  formatOpenCodeEventForOutput,
  invokeOpenCodeCli,
} from "./opencode-process.ts";
export { runHuman } from "./human.ts";
export type { HumanResult, UserInput } from "./human.ts";
export { OutputManager } from "./output.ts";
export type {
  RunSummary,
  VerboseInput,
  VerboseValidationResult,
} from "./output.ts";
export { Engine } from "./engine.ts";
export { buildUpdateCommand, checkForUpdate, VERSION } from "./version.ts";
export type { CheckForUpdateOptions, VersionCheckResult } from "./version.ts";
export { extractCliFlags, getVersionString, parseArgs } from "./cli.ts";
export type { CliFlags } from "./cli.ts";
