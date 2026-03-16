/**
 * @mnemo/harness — Core agent harness for Mnemo negotiation rooms.
 *
 * Re-exports all public modules.
 */

// Errors
export {
  ProviderError,
  AgentError,
  RoomError,
  StateError,
} from "./Errors.js"

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

// Room
export {
  Room,
  makeRoom,
  layer as RoomLayer,
  type RoomConfig,
  type RoomService,
  type Turn,
  type NegotiationResult,
} from "./Room.js"
