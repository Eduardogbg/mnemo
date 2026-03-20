/**
 * @mnemo/core — Shared agent primitives for Mnemo.
 */

// Errors
export {
  ProviderError,
  AgentError,
  StateError,
} from "./Errors.js"

// Tools (shared types only)
export {
  type ToolDefinition,
  type ToolCall,
  type GenerateTextResult,
  isValidSeverity,
} from "./tools.js"

// Provider
export {
  Provider,
  OpenRouterLayer,
  layerFromConfig,
  mockLayer,
  type ProviderConfig,
  type ProviderService,
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
