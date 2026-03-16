# Mnemo Protocol Specification

> Controlled forgetting for agent negotiation.

## Overview

Mnemo is a negotiation runtime where two AI agents communicate inside a TEE (Trusted Execution Environment). The core primitive: agents can **open scopes** to conditionally reveal sensitive information, and **close scopes** to retract it — deleting the revealed data from the shared state machine. It's SQL transactions for sensitive information.

The protocol has three layers:
1. **Session lifecycle** — discovery, mutual attestation, negotiation, settlement
2. **Negotiation state machine** — a conversation with scoped reveals, commit, and abort
3. **Context reconstruction** — how each agent's LLM prompt is built from the conversation state before each turn

## Core Insight: Reveals as Scopes

The fundamental operation in Mnemo isn't "fork a conversation." It's **scoped information disclosure**.

When an agent reveals sensitive data, it opens a **scope** — a transactional context that the revealing agent can unilaterally retract. Everything that happens inside a scope (messages, counter-reveals) is contingent on that scope staying open. If the scope owner closes it, all content inside is destroyed.

This maps directly to how negotiations actually work: "I'll show you X. If you like it, we proceed. If not, pretend you never saw it."

```
main:   [msg] → [msg] → [msg] ────────────────────→ [COMMIT]
                  │                                      ↑
scope(A):         └─{ reveal(A, data) → [msg] → [msg] } │
                                          │              │
                              (A closes → retract)       │
                              (both promote → main) ─────┘
```

### Why Scopes, Not Branches

The earlier "fork/rewind/merge" model treated the conversation as a git-like DAG with branches. But branches raise awkward consent questions: if Agent A wants to rewind and Agent B doesn't, who wins? In practice, they'd just abort — making bilateral rewind redundant with abort.

Scopes solve this cleanly. Each scope has an **owner** — the agent who opened it by revealing. The owner can always close their own scope (retract their reveal). The other agent *chose* to participate inside that scope, knowing it might be retracted. Consent is structural, not procedural.

### Nesting

Scopes can nest one level deep. This enables the core negotiation pattern:

```
main:    [msg] → [msg]
                  │
scope(A):         └─{ reveal(A, "preview of dataset")
                       │
scope(B):              └─{ reveal(B, "here's my price") }
                     }
```

Agent A reveals a preview. Agent B counter-reveals a price inside A's scope. Either party can retract:

- **A closes scope(A):** Everything inside is destroyed — A's preview AND B's price. B knew this was possible when they revealed inside A's scope.
- **B closes scope(B):** Only B's price is retracted. A's preview survives.
- **Both promote:** The scope content becomes permanent on main.

**Why two layers, not arbitrary depth:**
- One layer isn't enough: "I reveal X, you counter-reveal Y" requires nesting so either party can back out.
- Arbitrary depth explodes the state space and makes consent semantics confusing (if A closes a scope, everything nested inside it — including C's scope inside B's scope inside A's scope — is destroyed without C's explicit consent).
- Two layers covers the core use case and keeps verification tractable.

**The nesting rule:** You can only open a scope inside the current innermost scope or on main. So the maximum depth is: `main → scope(owner_1) → scope(owner_2)`. No deeper.

**Owner alternation:** A nested scope's owner must differ from its parent scope's owner. This enforces the counter-reveal pattern — you can't nest your own scope inside your own scope. If A opens a scope, only B can open a sub-scope inside it (to counter-reveal).

## Agent Actions

From an agent's perspective, there are only three things they can do:

### 1. Think (local, not a protocol operation)

The agent reasons privately — updates its own internal state (goals, constraints, strategy). This never crosses the boundary. The agent can "fork" its own thinking, explore scenarios, plan — none of that is visible to the protocol or the other agent. The TEE sandbox guarantees this.

### 2. Send a Message

Append a message to the shared conversation. Both agents see it. The message lives in whatever scope is currently active (main, or inside an open scope).

### 3. Structural Operations

These change the shape of the conversation:

| Operation | Consent | What happens |
|---|---|---|
| `open_scope(data)` | Unilateral | Reveal sensitive data, creating a new scope. The revealer owns the scope. |
| `close_scope` | Unilateral (owner only) | Retract your scope. **Destroys** all nodes inside it (real deletion, not hiding), wipes reveal_data, cascades to nested scopes. Overrides any pending consent. |
| `cancel_consent` | Unilateral (proposer only) | Withdraw your own pending proposal (promote or commit). |
| `promote` | Bilateral | Make scope content permanent in the **parent scope** (not necessarily main). Both agents approve. Nodes are reparented. |
| `commit(terms)` | Bilateral | Finalize the deal. Both approve the deal terms. Requires all scopes closed or promoted. Triggers on-chain settlement. |
| `abort` | Unilateral | Walk away. Destroy all state. Nothing leaks. Works even with pending consent. |

### Consent Model

The consent rules follow a simple principle: **you can always speak, reveal, retract your own reveals, and leave. But you can't make speculative content permanent or close a deal without the other party.**

- **Unilateral ops** (message, open_scope, close_scope, abort): One agent acts alone.
- **Bilateral ops** (promote, commit): Propose + accept from the other agent.

While a bilateral operation is pending, most unilateral operations are blocked — except **close_scope** and **abort**. A scope owner can always retract their own scope, even if a bilateral proposal is pending. This prevents a consent-freeze DoS where one agent blocks the other by keeping a proposal open indefinitely. The proposer can also **cancel_consent** to withdraw their own proposal.

### Key Invariant: No Information Leaks Backward

> Whatever persists in the conversation history after a scope closes must not encode information from inside the closed scope.

This is enforced by context reconstruction: after a scope closes, the LLM prompt is rebuilt from surviving nodes only. The agent's next turn has no access to the retracted content. (The model's weights may retain impressions from previous turns — see "The Memory Problem" below.)

### What About the Commit Message?

When agents commit, they produce two things:
1. **Shared deal terms** — mutually approved, published on-chain. This is the bilateral artifact.
2. **Private summary to owner** — each agent tells its human what happened. Not part of the protocol — just the agent's output.

The protocol enforces that the deal terms are mutually agreed. Each agent can report to its owner however it wants.

## The Conversation DAG

Under the hood, the conversation is still a DAG of nodes. Scopes are implemented as branches in the DAG, but with explicit ownership.

Each node contains:

| Field | Visibility | Purpose |
|---|---|---|
| `message` | Both agents | Shared conversation content |
| `private_a` | Agent A only | A's internal reasoning, goals |
| `private_b` | Agent B only | B's internal reasoning, goals |
| `parent` | Internal | Pointer to parent node |
| `scope_id` | Internal | Which scope this node belongs to (0 = main) |

Scope metadata (tracked separately from nodes):

| Field | Purpose |
|---|---|
| `id` | Unique scope identifier |
| `owner` | Agent who opened this scope |
| `parent_scope` | Enclosing scope (0 = main), enforces max nesting of 2 |
| `entry_node` | Node where scope was opened (for context reconstruction) |
| `status` | Open / Closed / Promoted |

## Context Reconstruction

Each agent is a **stateless LLM API call**. Before every turn, the harness reconstructs the agent's prompt from the DAG.

### Building Context

Walk from root to the agent's current position, collecting content from each node — but **skip nodes belonging to closed scopes**:

```
System prompt (persona, goals, available operations)
─────────────────────────────────
message from node 0 (root, main)
message from node 1 (main)
message from node 2 (main)
  ┌─ scope(A) open ─────────────
  │ reveal from node 3 (scope A)
  │ message from node 4 (scope A)
  │   ┌─ scope(B) open ─────────
  │   │ reveal from node 5 (B)
  │   │ message from node 6 (B)
  │   └─────────────────────────
  └─────────────────────────────
─────────────────────────────────
Agent's private state (all nodes)
```

If scope(A) is closed, nodes 3-6 vanish from the context. If only scope(B) is closed, nodes 5-6 vanish but 3-4 survive.

### KV Cache Behavior

The conversation structure is KV-cache-friendly:

- **Closing a scope:** The surviving context (main up to the scope entry point) is a **prefix** of the old context. Prefix caching gives a cache hit on everything before the scope.
- **Normal message:** Cache hit on everything except the new message.
- **Opening a scope:** Cache hit on the main prefix; the reveal starts a new suffix.

Retracting a scope is computationally cheap — you're trimming a suffix and rebuilding from a cached prefix.

### The Memory Problem

Closing a scope deletes data from the state machine. But the LLM may have "seen" the deleted information in a previous turn's context window.

**For the hackathon:** Each inference call is stateless (API call to Venice). Context is reconstructed from the DAG each turn. After a scope closes, the retracted content simply isn't in the next prompt. The TEE guarantees the state is deleted. This is sufficient.

**For production:** The concern is that an agent's *behavior* in later turns might be influenced by retracted information (the model "remembers" even though it can't see the data). Mitigations: restart the inference session from a checkpoint, or use a different model instance. For API-based inference with no persistent state, this is already handled.

## Session Lifecycle

```
Idle → Discovery → Handshake → Active → Done
```

1. **Idle** — No session. Agents haven't found each other yet.
2. **Discovery** — Agents exchange capabilities and intent.
3. **Handshake** — Mutual TEE attestation. Each agent verifies the other is running inside a legitimate enclave with expected code. Both must verify. Re-presenting credentials invalidates the other's verification (prevents stale-attestation attacks — caught by our formal spec).
4. **Active** — The negotiation runs. Agents message, reveal, retract, promote, commit, or abort.
5. **Done** — Negotiation ended. On commit: on-chain settlement. On abort: nothing leaks.

## Formal Specification

The protocol is formally specified in [Quint](https://quint-lang.org/), an executable TLA+ dialect. The spec lives in `spec/quint/`.

### Files

| File | What it models |
|---|---|
| `types.qnt` | Shared types: Agent, Node, Scope, SessionStatus |
| `negotiation.qnt` | Scope operations, messaging, commit, abort |
| `session.qnt` | Session lifecycle state machine |
| `attestation.qnt` | TEE attestation exchange |
| `context.qnt` | Agent context reconstruction from DAG |
| `properties.qnt` | Safety invariants |
| `scenarios.qnt` | Test traces |

### Safety Invariants (15 checked, all verified)

1. **Heads lockstep** — Both agents always share the same head position
2. **Heads are valid** — Head references an existing node
3. **Head/scope consistency** — Node at head belongs to currentScope or main
4. **Nesting limit** — No scope exceeds depth 2
5. **Scope owner alternation** — Nested scope's owner differs from parent's owner
6. **Scope graph well-formedness** — parent_scope exists or is MAIN_SCOPE; entry_node exists unless scope is closed
7. **Closed scopes have no nodes** — Real deletion: no node in the map belongs to a closed scope
8. **Closed scopes have no reveal_data** — Wipe on close, not just status flip
9. **Close cascades** — If a scope is closed, all nested scopes are also closed
10. **Promotion hygiene** — After promotion, no node retains the promoted scope_id (reparented to parent)
11. **Commit is clean** — No pending proposals or open scopes survive a commit
12. **Abort destroys state** — After abort, all nodes and scopes are gone
13. **Active sessions have nodes** — An active session always has at least one node
14. **Current scope is valid** — currentScope is MAIN_SCOPE or an open scope in the map
15. **No closed-scope content in context** — `buildContext()` output never contains messages from closed-scope nodes

Additionally, the attestation module verifies:
- **Attestation integrity** — Attestation only completes if both agents have currently valid credentials (re-presenting a quote invalidates the other's verification)

### Running the Spec

```bash
npm install -g @informalsystems/quint

# Test scenarios
quint test spec/quint/scenarios.qnt

# Simulate with invariant checking (10k random traces)
quint run --invariant=all_invariants spec/quint/properties.qnt \
  --max-steps=20 --max-samples=10000

# Attestation
quint run --invariant=attestation_requires_valid_quotes \
  spec/quint/attestation.qnt --max-steps=10 --max-samples=10000

# Session lifecycle
quint run --invariant=negotiation_requires_attestation \
  spec/quint/session.qnt --max-steps=10 --max-samples=10000
```

## Design Decisions

| Question | Decision | Rationale |
|---|---|---|
| Can agents be on different scopes simultaneously? | No — both agents share the same scope context | Simplifies consensus; agents are negotiating *together* |
| Who can close a scope? | Only the owner (the agent who revealed) | You can retract your own data, not mine |
| What happens to nested content when a scope closes? | Destroyed (cascade) | Everything inside was contingent on the scope existing |
| Max nesting depth? | 2 (main → scope → sub-scope) | Covers core use case; deeper nesting has unclear consent semantics |
| Is promote bilateral? | Yes | Making speculative content permanent requires consent |
| Is abort bilateral? | No — unilateral | You can always walk away |
| Can close_scope override pending consent? | Yes — owner retraction always wins | Prevents consent-freeze DoS (found via formal spec critique) |
| Does promote go to main? | No — to parent scope | If scope(B) is inside scope(A), promoting B merges into A, not main |
| Must nested scope owners differ? | Yes — alternation enforced | Prevents same-agent double-nesting; enforces counter-reveal pattern |
| Separate commit message per agent? | Shared deal terms (bilateral) + private owner summary (not protocol) | Protocol enforces mutual agreement on terms; reporting is agent's business |
