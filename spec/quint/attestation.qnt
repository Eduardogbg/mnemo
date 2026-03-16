// Mnemo Protocol — Abstract TEE Attestation (Phase 3)
// Models the attestation exchange without crypto details.
//
// Each agent:
// 1. Presents an attestation quote (abstract: valid boolean + code hash)
// 2. Counterparty verifies it
// 3. Both must be verified before negotiation begins

module attestation {

  import types.* from "./types"

  // ─── Types ─────────────────────────────────────────────────────

  type Quote = {
    agent: Agent,
    valid: bool,
    codeHash: str,
  }

  type VerificationResult = {
    agent: Agent,
    accepted: bool,
  }

  // ─── State ─────────────────────────────────────────────────────

  var quotes: Agent -> Quote
  var verifications: Agent -> VerificationResult  // keyed by VERIFIER
  var attestationComplete: bool

  // ─── Init ──────────────────────────────────────────────────────

  action init = all {
    quotes' = Map(
      AgentA -> { agent: AgentA, valid: false, codeHash: "" },
      AgentB -> { agent: AgentB, valid: false, codeHash: "" }
    ),
    verifications' = Map(
      AgentA -> { agent: AgentA, accepted: false },
      AgentB -> { agent: AgentB, accepted: false }
    ),
    attestationComplete' = false,
  }

  // ─── Actions ───────────────────────────────────────────────────

  action presentQuote(agent: Agent, isValid: bool, hash: str): bool = all {
    not(attestationComplete),
    quotes' = quotes.set(agent, { agent: agent, valid: isValid, codeHash: hash }),
    // Re-presenting a quote invalidates any existing verification of it
    // (the other agent verified a DIFFERENT quote, so their verification is stale)
    val verifier = otherAgent(agent)
    verifications' = verifications.set(verifier, { agent: verifier, accepted: false }),
    attestationComplete' = false,
  }

  action verifyQuote(verifier: Agent): bool = all {
    not(attestationComplete),
    val target = otherAgent(verifier)
    val quote = quotes.get(target)
    val accepted = quote.valid and quote.codeHash == "mnemo-v1"
    val otherVerification = verifications.get(otherAgent(verifier))
    all {
      quotes' = quotes,
      verifications' = verifications.set(verifier, { agent: verifier, accepted: accepted }),
      attestationComplete' = (accepted and otherVerification.accepted),
    }
  }

  // ─── Step ──────────────────────────────────────────────────────

  action step = {
    nondet agent = Set(AgentA, AgentB).oneOf()
    nondet valid = Set(true, false).oneOf()
    any {
      presentQuote(agent, valid, "mnemo-v1"),
      presentQuote(agent, valid, "malicious-code"),
      verifyQuote(agent),
    }
  }

  // ─── Properties ────────────────────────────────────────────────

  val attestation_requires_valid_quotes: bool = {
    attestationComplete implies (
      quotes.get(AgentA).valid and quotes.get(AgentA).codeHash == "mnemo-v1" and
      quotes.get(AgentB).valid and quotes.get(AgentB).codeHash == "mnemo-v1"
    )
  }
}
