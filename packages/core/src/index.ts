/**
 * @mnemo/core — Shared agent primitives for Mnemo.
 */

// Errors
export {
  AgentError,
  StateError,
} from "./Errors.js"

// Tools (validation helpers)
export {
  isValidSeverity,
} from "./tools.js"

// Provider (LanguageModel wrappers)
export {
  model,
  VeniceModel,
  OpenRouterModel,
  mockModel,
  type ChatCompletionsConfig,
} from "./Provider.js"

// State
export {
  State,
  InMemoryLayer,
  type StateService,
  type Message,
} from "./State.js"

// Agent
export {
  Agent,
  makeAgent,
  layer as AgentLayer,
  type AgentConfig,
  type AgentRole,
  type AgentRunResult,
  type AgentService,
} from "./Agent.js"
