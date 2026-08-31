/**
 * @module
 * Barrel re-export for `deno doc --lint` entry point. Not imported by runtime code.
 */

export type {
  AttemptJournalEvent,
  CliRunOutput,
  EngineOptions,
  ErrorCategory,
  ForkConfig,
  HitlConfig,
  HumanInputOption,
  HumanInputRequest,
  LoopIterationJournalEvent,
  NodeBudget,
  NodeConfig,
  NodeDeclaredJournalEvent,
  NodeDirectoryDeclaredJournalEvent,
  NodeLifecycleCallback,
  NodeLifecycleEvent,
  NodeLifecycleJournalEvent,
  NodeLifecycleMetadata,
  NodeSettings,
  NodeState,
  NodeStatus,
  PermissionDenial,
  PermissionMode,
  ReasoningEffort,
  ResolvedNodeSettings,
  RunAttemptStartedJournalEvent,
  RunJournalEvent,
  RunJournalEventBase,
  RunJournalEventKind,
  RunJournalReplayResult,
  RunMetadataUpdatedJournalEvent,
  RunStartedJournalEvent,
  RunState,
  RunTerminalJournalEvent,
  RuntimeId,
  TemplateContext,
  ValidationRule,
  Verbosity,
  WorkflowConfig,
  WorkflowDefaults,
  WorkflowLoadedJournalEvent,
} from "./types.ts";
export { REASONING_EFFORT_VALUES } from "./types.ts";

export { interpolate } from "./config/template.ts";
export {
  DEFAULT_SETTINGS,
  extractWorktreeDisabled,
  loadConfig,
  parseConfig,
} from "./config/config.ts";
export type { ConfigWarnSink } from "./config/config.ts";
export { buildLevels, buildLoopBodyOrder } from "./engine/dag.ts";
export type { ExecutionLevels } from "./engine/dag.ts";
export {
  allPassed,
  formatFailures,
  runValidations,
} from "./config/validate.ts";
export type { ValidationResult } from "./config/validate.ts";
export {
  createRunState,
  generateRunId,
  getNodeDir,
  getRunDir,
  PhaseRegistry,
} from "./state/state.ts";
export {
  getJournalPath,
  loadStateFromJournal,
  replayRunJournal,
  resultExcerpt,
  RunJournalWriter,
} from "./state/run-journal.ts";
export type { NewRunJournalEvent } from "./state/run-journal.ts";
export { installSignalHandlers, ProcessRegistry } from "./process-registry.ts";
export { runAgent } from "./engine/agent.ts";
export type { AgentResult, AgentRunOptions } from "./engine/agent.ts";
// Runtime adapter types re-exported from `@korchasa/ai-ide-cli` so engine's
// public AgentRunOptions / HitlRunOptions / ClaudeRunner remain
// self-contained from deno doc --lint's point of view.
export type {
  CallbackErrorSource,
  CliRunUsage,
  ExtraArgsMap,
  InteractiveOptions,
  InteractiveResult,
  McpHttpServer,
  McpServers,
  McpServerSpec,
  McpStdioServer,
  OnCallbackError,
  OnRuntimeToolUseObservedCallback,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeErrorAnalysis,
  RuntimeErrorAnalysisInput,
  RuntimeErrorCategory,
  RuntimeErrorConfidence,
  RuntimeErrorKind,
  RuntimeErrorSource,
  RuntimeInitInfo,
  RuntimeInvokeOptions,
  RuntimeInvokeResult,
  RuntimeLifecycleHooks,
  RuntimeSession,
  RuntimeSessionEvent,
  RuntimeSessionOptions,
  RuntimeSessionStatus,
  RuntimeToolUseDecision,
  RuntimeToolUseInfo,
  TransportOption,
} from "@korchasa/ai-ide-cli/runtime/types";
// AcpFrontLauncher is reachable only via the runtime index barrel, not the
// `runtime/types` barrel; RuntimeInvokeOptions/RuntimeSessionOptions.acpFront
// reference it, so it must be public for doc-lint completeness.
export type { AcpFrontLauncher } from "@korchasa/ai-ide-cli/runtime";
// RuntimeErrorCategory is a union built from this `as const` value; it must
// be public for doc-lint completeness.
export { ERROR_CATEGORY_STREAM_STALL } from "@korchasa/ai-ide-cli/runtime";
export type { SettingSource } from "@korchasa/ai-ide-cli/runtime/setting-sources";
export type {
  CapabilityInventory,
  CapabilityRef,
  FetchCapabilitiesOptions,
} from "@korchasa/ai-ide-cli/runtime/capabilities";
export type { SkillDef, SkillFrontmatter } from "@korchasa/ai-ide-cli/skill";
export { isHitlConfigured, runHitlLoop } from "./hitl/hitl.ts";
export type {
  ClaudeRunner,
  HitlQuestion,
  HitlRunOptions,
  ScriptRunner,
} from "./hitl/hitl.ts";
export { markNodeWaiting } from "./state/state.ts";
export { saveAgentLog } from "./state/log.ts";
export { extractFrontmatterField, runLoop } from "./engine/loop.ts";
export type {
  LoopExitReason,
  LoopResult,
  LoopRunOptions,
} from "./engine/loop.ts";
export { runHuman } from "./engine/human.ts";
export type { HumanResult, UserInput } from "./engine/human.ts";
export { OutputManager } from "./output.ts";
export type {
  RunSummary,
  VerboseInput,
  VerboseValidationResult,
} from "./output.ts";
export { Engine } from "./engine/engine.ts";
export { buildUpdateCommand, checkForUpdate, VERSION } from "./version.ts";
export type { CheckForUpdateOptions, VersionCheckResult } from "./version.ts";
export { extractCliFlags, getVersionString, parseArgs } from "./cli.ts";
export type { CliFlags } from "./cli.ts";
export { applyJsonPointerOp, runMcpServer } from "./mcp/mcp-server.ts";
export type { JsonPointerOp, RunMcpServerOptions } from "./mcp/mcp-server.ts";
