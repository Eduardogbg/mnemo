/**
 * @mnemo/harness — Negotiation room for Mnemo.
 *
 * Re-exports @mnemo/core for convenience.
 */

// Re-export @mnemo/core
export {
  AgentError,
  StateError,
  isValidSeverity,
  model,
  VeniceModel,
  OpenRouterModel,
  mockModel,
  type ChatCompletionsConfig,
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

// Harness-specific: Errors
export { RoomError } from "./Errors.js"

// Harness-specific: Tools (Tool.make + Toolkit.make)
export {
  ApproveBug,
  RejectBug,
  AcceptSeverity,
  RejectSeverity,
  verifierToolkit,
  proverToolkit,
  verifierHandlersLayer,
  proverHandlersLayer,
} from "./tools.js"

// Harness-specific: Room
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
