// Mnemo Protocol — Session Lifecycle (Phase 2)
// The outer state machine wrapping the negotiation module.
//
// States: Idle -> Discovery -> Handshake -> Active -> Done
//
// In the Active state, the negotiation module runs.

module session {

  import types.* from "./types"

  // ─── Session Lifecycle States ──────────────────────────────────

  type LifecycleState =
    | Idle
    | Discovery
    | Handshake
    | NegotiationActive
    | Done

  type AttestationStatus =
    | NotStarted
    | AgentAVerified
    | AgentBVerified
    | BothVerified

  // ─── State ─────────────────────────────────────────────────────

  var lifecycle: LifecycleState
  var attestation: AttestationStatus

  // ─── Init ──────────────────────────────────────────────────────

  action init = all {
    lifecycle' = Idle,
    attestation' = NotStarted,
  }

  // ─── Transitions ───────────────────────────────────────────────

  action discover: bool = all {
    lifecycle == Idle,
    lifecycle' = Discovery,
    attestation' = attestation,
  }

  action startHandshake: bool = all {
    lifecycle == Discovery,
    lifecycle' = Handshake,
    attestation' = NotStarted,
  }

  action verifyAgent(agent: Agent): bool = all {
    lifecycle == Handshake,
    match agent {
      | AgentA =>
          match attestation {
            | NotStarted => all { attestation' = AgentAVerified, lifecycle' = lifecycle }
            | AgentBVerified => all { attestation' = BothVerified, lifecycle' = lifecycle }
            | _ => all { attestation' = attestation, lifecycle' = lifecycle }
          }
      | AgentB =>
          match attestation {
            | NotStarted => all { attestation' = AgentBVerified, lifecycle' = lifecycle }
            | AgentAVerified => all { attestation' = BothVerified, lifecycle' = lifecycle }
            | _ => all { attestation' = attestation, lifecycle' = lifecycle }
          }
    }
  }

  action enterNegotiation: bool = all {
    lifecycle == Handshake,
    attestation == BothVerified,
    lifecycle' = NegotiationActive,
    attestation' = attestation,
  }

  action finish: bool = all {
    lifecycle == NegotiationActive,
    lifecycle' = Done,
    attestation' = attestation,
  }

  // ─── Step ──────────────────────────────────────────────────────

  action step = any {
    discover,
    startHandshake,
    val a = AgentA
    verifyAgent(a),
    val b = AgentB
    verifyAgent(b),
    enterNegotiation,
    finish,
  }

  // ─── Properties ────────────────────────────────────────────────

  val negotiation_requires_attestation: bool = {
    (lifecycle == NegotiationActive) implies (attestation == BothVerified)
  }
}
