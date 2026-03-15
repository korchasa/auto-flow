/** Barrel re-export for `deno doc --lint` entry point. Not imported by runtime code. */

export type {
  ClaudeCliOutput,
  EngineOptions,
  ErrorCategory,
  HitlConfig,
  NodeConfig,
  NodeSettings,
  NodeState,
  NodeStatus,
  PermissionDenial,
  PipelineConfig,
  PipelineDefaults,
  RunState,
  TemplateContext,
  ValidationRule,
  Verbosity,
} from "./types.ts";

export { interpolate } from "./template.ts";
export {
  DEFAULT_SETTINGS,
  extractPreRun,
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
export { runHuman } from "./human.ts";
export type { HumanResult, UserInput } from "./human.ts";
export { OutputManager } from "./output.ts";
export type {
  RunSummary,
  VerboseInput,
  VerboseValidationResult,
} from "./output.ts";
export { Engine, runPreRunScript } from "./engine.ts";
