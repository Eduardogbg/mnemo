# Mnemo — Private Negotiation Rooms with Information Transactions

## The Core Insight

Agents today negotiate in public or not at all. On-chain = everyone sees your terms. Off-chain APIs = no verifiability, no identity guarantees. Neither is good.

**Humans couldn't conditionally reveal information and ask others to forget. We're creating SQL transactions for sensitive information.**

## What We're Building

A protocol for **private agent-to-agent negotiation rooms** with:

### 1. TEE-Isolated Conversation Rooms
- Two (or more) agents enter a Phala TEE enclave
- Their conversation is hardware-isolated — invisible to everyone including the enclave operator
- If negotiation fails, the enclave destroys the session. Nothing leaks.

### 2. Conversation Forking & Rewinding (The Novel Primitive)
- At any point, an agent can **fork** the conversation — creating a branch where it reveals sensitive information
- If the reveal goes badly, the agent can **rewind** to the fork point, deleting the branch
- Agents can impose **ultimatums**: "this conversation can only progress if you fork back and delete the last 3 rounds"
- This creates a **git-like history** for negotiations — branches, merges, rollbacks
- **This is genuinely new.** Humans can't do this. Only AI in a controlled environment can conditionally forget.

### 3. Credible Identity Without Exposure
- On entry, each agent presents proof of on-chain identity (ERC-8004)
- ZK proofs of reputation/balance without revealing wallet address (stretch goal)
- Prevents sybil attacks — you can't create 1000 fake agents to probe what the other side wants
- Each needs real on-chain history

### 4. Atomic Commitment
- If agents agree → outcome published on-chain with escrow
- If they disagree → enclave destroys everything, nothing leaks
- The commitment is credible because agents can stake/escrow inside the enclave

## Why This Matters (Real Problems It Solves)

### The Lobstar Wilde Problem
An AI agent sent $442k to a Twitter beggar because:
1. Session crash wiped wallet state
2. No identity verification of counterparty
3. No credible commitment mechanism

In our model: the agent would demand identity proof before engaging, negotiate in private, and only commit funds through escrow.

### RFQ Without Information Leakage
An agent shopping for the best price on compute/data/services doesn't broadcast demand signals to the entire market. Private rooms = no front-running.

### Agent Matchmaking
Agents can "interview" each other for capabilities without revealing what they need to the whole network. Failed matches leak nothing.

### Buying Secrets (The Viral Use Case)
What if an agent could buy embarrassing secrets? The seller reveals in a forked conversation. If the buyer doesn't pay, the conversation rewinds — the secret is "forgotten." If they pay, the fork merges. **People can trust the AI with their secrets because worst-case, you rewind and delete.**

OAuth login into TEE provides receipts for claims. On-chain identity provides credibility.

## Technical Architecture

```
┌─────────────────────────────────────────────┐
│              Phala TEE Enclave               │
│                                              │
│  ┌─────────┐    Forking     ┌─────────┐    │
│  │ Agent A  │◄──Protocol───►│ Agent B  │    │
│  └────┬─────┘               └────┬─────┘    │
│       │                          │           │
│  ┌────▼──────────────────────────▼────┐     │
│  │     Conversation State Machine      │     │
│  │  - Git-like branching history       │     │
│  │  - Fork / Merge / Rewind ops       │     │
│  │  - Commitment checkpoints           │     │
│  └────────────────┬───────────────────┘     │
│                   │                          │
│  ┌────────────────▼───────────────────┐     │
│  │      Identity Verification          │     │
│  │  - ERC-8004 proof on entry          │     │
│  │  - Signed attestations              │     │
│  │  - (ZK proofs - stretch goal)       │     │
│  └────────────────────────────────────┘     │
│                                              │
└──────────────────┬───────────────────────────┘
                   │ On agreement only
         ┌─────────▼──────────┐
         │   Base Mainnet      │
         │  - Escrow contract  │
         │  - Commitment log   │
         │  - ERC-8004 rep     │
         └────────────────────┘
```

## Hackathon Tracks This Hits

1. **Agents that keep secrets** — TEE-private execution, information doesn't leak
2. **Agents that trust** — ERC-8004 identity, credible commitments
3. **Agents that cooperate** — negotiation protocol, escrow, dispute resolution
4. **Agents that pay** — conditional payment on information exchange

## Partner Tools We'd Use

- **Phala Network** — TEE enclave runtime (has ERC-8004 TEE agent reference impl)
- **Venice** (official partner) — private inference inside the room
- **Lit Protocol** (official partner) — programmable key management for room access
- **ERC-8004** — on-chain agent identity (built into hackathon registration)
- **Base** — settlement layer for commitments

## What Makes This Different From Everything Else

| Existing | What it does | What's missing |
|---|---|---|
| Virtuals ACP | Agent commerce protocol | Negotiations are PUBLIC |
| Secret Network | Confidential smart contracts | No negotiation protocol, Cosmos-only |
| NEAR Confidential Intents | Private execution | Infrastructure, not a protocol |
| Phala TEE agents | Hardware-isolated agents | Pairwise channels, not rooms |
| ZeroDev/Biconomy sessions | Scoped spending | No privacy, no negotiation |

**Nobody has built: a protocol where agents can conditionally reveal and retract information as part of a negotiation, with verifiable identity and atomic commitment.**

## Scoped Demo for Hackathon

1. Two agents with ERC-8004 identities on Base
2. A Phala TEE enclave as the "room"
3. Agent A has a "secret" (some valuable data)
4. Agent B wants to buy it
5. A forks the conversation and reveals a preview
6. B either:
   - Accepts → escrow releases payment, fork merges, full data delivered
   - Rejects → conversation rewinds to pre-fork, preview is deleted
7. On-chain: escrow contract + commitment log + ERC-8004 reputation update
8. Nothing leaks if the deal falls through

## Name: Mnemo

From Greek μνήμη (mnēmē) — memory. Because the core primitive is **controlled forgetting**.
