# On-Chain Privacy for Bug Disclosure Settlement

> Research date: 2026-03-19
> Context: Mnemo hackathon (The Synthesis). Designing settlement layer for private bug disclosure negotiations.

---

## The Problem

When a protocol funds an escrow for a bug disclosure, the on-chain transaction leaks that this protocol is involved in a vulnerability negotiation. Even with blind commitment hashes (no severity/details on-chain), the mere act of funding an escrow from a known protocol address signals "we have a bug."

This is the exact sensitive information we're trying to protect.

## Approaches Evaluated

### 1. Naive On-Chain Escrow (MnemoEscrow.sol — current)

**How it works:** TEE creates escrow with commitment hash. Protocol funds directly.

**What an observer learns:** Protocol address X funded a Mnemo escrow → "X likely has a vulnerability."

**Verdict:** Insufficient. The funding transaction is a signal.

---

### 2. TEE as Funding Pool (MnemoPool)

**How it works:** A generic pool contract that anyone can deposit into. TEE holds the only withdrawal key. All escrow logic lives inside the CVM. On-chain, deposits look like generic Mnemo interactions (staking, protocol fees, whatever).

```
Observer sees:             TEE knows internally:
Protocol → MnemoPool       "Protocol X deposited 5 ETH for escrow #7"
Random → MnemoPool          "Researcher Y deposited 0.1 ETH stake"
MnemoPool → addr_A          "Released 5 ETH for escrow #7"
```

**What an observer learns:** "Address X interacted with Mnemo." Cannot distinguish bug disclosure funding from any other Mnemo activity.

**Privacy:** Better — hides the purpose. Does NOT hide who interacts with Mnemo.

**Implementation:** Simple. Replace MnemoEscrow with a pool contract + TEE-internal ledger.

**Verdict:** Good for hackathon. Weaker than stealth addresses.

---

### 3. Stealth Addresses (ERC-5564) — Recommended

**How it works:** TEE generates a one-time stealth address for each deposit. Protocol sends funds to that address — it's unlinkable to both the protocol's main address and to Mnemo without the TEE's viewing key.

```
Observer sees:                    TEE knows (via viewing key):
Protocol → 0xabc123 (random)     "Protocol X funded escrow #7 via stealth addr"
Protocol → 0xdef456 (random)     "Protocol Y funded escrow #12 via stealth addr"
TEE wallet → Researcher           "Released 5 ETH for escrow #7"
```

**What an observer learns:** "Someone sent ETH to a random address." Cannot link it to the protocol, to Mnemo, or to bug disclosures.

**Privacy:** Best. Observer cannot even tell the transaction is Mnemo-related.

**Implementation:**
- TEE holds a stealth meta-address (spending key + viewing key via Phala's `getKey()`)
- Per-escrow: TEE derives a stealth address, gives it to the protocol off-chain (inside the negotiation room)
- Protocol funds that address from any wallet (can even use a fresh wallet)
- TEE scans chain for deposits to stealth addresses using the viewing key
- Settlement: TEE sweeps stealth addresses → TEE wallet → researcher payout

**ERC-5564 on Base:** Umbra protocol supports Base. Alternatively, implement minimal stealth address generation ourselves (just ECDH + keccak — simpler than full Umbra integration for the hackathon).

**Composability with ERC-8004:** Reputation posting happens from the TEE address after resolution. The stealth addresses are ephemeral and never linked to agent IDs.

**Verdict:** Best privacy, moderate implementation effort. Recommended approach.

---

### 4. ZK Proofs

**How it works:** Protocol proves in zero knowledge that they deposited the correct amount for a specific (hidden) escrow without revealing which escrow or their identity.

**Privacy:** Strongest theoretical guarantees — trustless, no TEE dependency.

**Implementation:** Heavy. Need a ZK circuit for deposit verification, proof generation on the client side, on-chain verifier. Doable in a hackathon by an experienced ZK dev, but higher risk.

**Verdict:** Overkill given we already have TEE trust. The TEE is already trusted to run the negotiation — adding ZK for settlement but not for negotiation is inconsistent. Save for production if TEE trust becomes insufficient.

---

## Implementation Difficulty Ranking

1. **TEE pool** — Easiest. One simple contract, TEE-internal ledger.
2. **Stealth addresses** — Moderate. ECDH key generation, scanning logic, sweep transactions.
3. **ZK proofs** — Hardest. Circuit design, proof generation, on-chain verifier.

## Recommended Architecture

```
On-chain (Base):                    Inside TEE (Phala CVM):
─────────────────                   ───────────────────────
MnemoPool.sol (minimal)             Escrow state machine
  - receive() (anyone)              Stealth address generation
  - withdraw() (TEE only)           Chain scanning (viewing key)
  - commitHash log (events)         Sweep + settlement logic
                                    ERC-8004 reputation posting
ERC-8004 Identity Registry
ERC-8004 Reputation Registry        Encrypted Docker volume
                                    Key: getKey("mnemo/wallet")
```

**Key insight:** Moving escrow logic into the TEE means the on-chain footprint is minimal. The chain becomes a settlement rail, not a state machine. Privacy comes from the TEE mediating all interactions.

---

## Open Questions

1. **Gas for stealth address sweeps:** Each stealth address sweep costs gas. Who pays? TEE wallet needs to be funded. Could batch sweeps to amortize.
2. **Stealth address scanning latency:** How often does the TEE scan for deposits? Every block? Polling interval?
3. **Researcher-side privacy:** Less critical (researchers are expected to participate in bounty programs), but stealth addresses could be used for researcher deposits too.
4. **Amount privacy:** Fixed denomination deposits (like Tornado Cash) would hide amounts. Variable amounts are linkable by value. For hackathon: accept this limitation. For production: consider fixed tiers.
