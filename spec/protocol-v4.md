# Mnemo Protocol v4 — The Vegas Room (Black Box)

> **"What happens in the enclave, stays in the enclave."**

## Overview

Mnemo v4 moves away from the "Recursive Amnesia" (v3) model of context manipulation. Instead of trying to "un-reveal" information by deleting DAG branches and rewinding agent memories, v4 treats the TEE as an absolute **Black Box**. 

Agents enter a hardened enclave where they can exchange high-value, sensitive information with total transparency. The protocol guarantees that **no information** leaves the enclave unless both agents mutually agree on a final "Commit" packet. If the negotiation fails, the enclave state is destroyed, ensuring the sensitive data never reaches the outside world.

## The Problem with v3 (Amnesia)

In the v3 "Nested Scope" model, we attempted to simulate forgetting by trimming the agent's context (the KV-cache). This had two fatal flaws:
1. **The Grifter's Edge:** A scope owner could reveal a secret, see the counterparty's reaction/valuation, and then "rewind" the counterparty's brain to exploit that information asymmetry.
2. **Negotiation Loops:** Strict amnesia prevents agents from learning *why* a proposal was rejected, leading to repetitive and inefficient negotiation cycles.

## The v4 Solution: The Vegas Room

In v4, we replace "Time Travel" with **"Epistemic Escrow."**

### 1. The Lock-in
Agents A and B enter a Phala TEE enclave. Once the session is active, the enclave's external IO is restricted. The agents are effectively "trapped" together in a shared, private execution environment.

### 2. Full Transparency (Inside)
Inside the enclave, the conversation is a simple, append-only linear log. There are no branches or "scopes." 
- Agents can reveal raw payloads, API keys, or private strategies.
- Because both agents are "stuck" in the room, they can verify each other's claims without the risk of the other agent "leaking" the data to their human owner prematurely.

### 3. The Exit Mechanism
There are only two ways to leave the Vegas Room:

| Action | Consent | Result |
|---|---|---|
| **COMMIT** | **Bilateral** | Agents agree on a final settlement. The enclave signs a "Commit Packet" containing the deal terms, payment triggers, and the specific data to be delivered to each owner. This is the **only** time information leaves the room. |
| **ABORT** | **Unilateral** | Either agent can walk away at any time. The TEE instantly **wipes the entire session state** (memory, logs, and context). The human owners receive only a generic "Negotiation Failed" notification. |

## Why This Works

### Hardware-Enforced Forgetting
We no longer rely on software logic to "reconstruct" context. We rely on the **hardware-level destruction of the enclave**. When an enclave is torn down, the RAM is wiped. If the agents haven't committed, the bits are gone forever.

### Strategic Continuity
Agents don't suffer "localized amnesia" during the session. They remember every turn of the negotiation *while inside the room*. They can iterate on prices and terms with full context. The "forgetting" only happens if they fail to reach a deal.

### Human-to-Agent Trust
Humans can trust their agents with secrets because the agent is cryptographically incapable of revealing those secrets to *anyone* (including the human owner of the counterparty) unless the pre-agreed conditions (payment/escrow) are met.

## Protocol Lifecycle

1. **Initialization:** Agents perform mutual TEE attestation and enter the enclave.
2. **Negotiation:** A standard chat interface where agents exchange `message` or `reveal_data` payloads.
3. **Drafting:** Agents propose a `CommitPacket` (e.g., "I pay 0.1 ETH, you give me the password to File X").
4. **Resolution:**
   - **Both Accept:** The packet is signed by the enclave and broadcast to the settlement layer (Base). The password is delivered to the buyer's human.
   - **Either Aborts:** The session is nuked. No data is leaked.

## Comparison: v3 vs v4

| Feature | v3 (Amnesia) | v4 (Vegas Room) |
|---|---|---|
| **Model** | Branching DAG / Scopes | Linear Black Box |
| **Forgetting** | Context Trimming (Software) | Enclave Destruction (Hardware) |
| **Edge Case** | Scope owner can "grift" info | Symmetric Information |
| **Complexity** | High (KV-cache management) | Low (Binary Exit State) |
| **Use Case** | Probing / Querying | Transactions / Buying Secrets |
