/**
 * @mnemo/harness — Negotiation room for Mnemo.
 *
 * Re-exports @mnemo/core for convenience.
 */

// Re-export all of @mnemo/core for downstream convenience
export {
  ProviderError,
  AgentError,
  StateError,
  type ToolDefinition,
  type ToolCall,
  type GenerateTextResult,
  isValidSeverity,
  Provider,
  OpenRouterLayer,
  layerFromConfig,
  mockLayer,
  type ProviderConfig,
  type ProviderService,
  State,
  InMemoryLayer,
  type StateService,
  type Message,
  Agent,
  makeAgent,
  AgentLayer,
  type AgentConfig,
  type AgentRole,
  type AgentRunResult,
  type AgentService,
} from "@mnemo/core"

// Harness-specific: Room
export { RoomError } from "./Errors.js"

export {
  verifierTools,
  proverTools,
} from "./tools.js"

export {
  Room,
  makeRoom,
  layer as RoomLayer,
  type RoomConfig,
  type RoomService,
  type Turn,
  type NegotiationResult,
  type NegotiationOutcome,
} from "./Room.js"
