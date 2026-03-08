// Public API re-exports for the pipeline engine.

export type {
  ClaudeCliOutput,
  EngineOptions,
  NodeConfig,
  NodeSettings,
  NodeState,
  NodeStatus,
  PipelineConfig,
  PipelineDefaults,
  RunState,
  TemplateContext,
  ValidationRule,
  Verbosity,
} from "./types.ts";

export { interpolate } from "./template.ts";
export { DEFAULT_SETTINGS, loadConfig, parseConfig } from "./config.ts";
export { buildLevels, buildLoopBodyOrder } from "./dag.ts";
export {
  allPassed,
  formatFailures,
  runValidations,
} from "./validate.ts";
export {
  createRunState,
  generateRunId,
  getNodeDir,
  getRunDir,
  getStatePath,
  loadState,
  saveState,
} from "./state.ts";
export { runAgent } from "./agent.ts";
export type { AgentResult } from "./agent.ts";
export { extractFrontmatterField, runLoop } from "./loop.ts";
export type { LoopResult } from "./loop.ts";
export { runHuman } from "./human.ts";
export type { HumanResult, UserInput } from "./human.ts";
export {
  commitNodeChanges,
  getCurrentBranch,
  pushToOrigin,
  safetyCheckDiff,
} from "./git.ts";
export { OutputManager } from "./output.ts";
export type { RunSummary } from "./output.ts";
export { Engine } from "./engine.ts";
