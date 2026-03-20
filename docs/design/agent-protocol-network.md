# Agent-Protocol Discovery and Connection

> Design document. March 20, 2026.
> How autonomous security researcher agents find, connect to, and negotiate with DeFi protocols through Mnemo.

---

## 1. The Problem

The current demo hardcodes everything: the researcher agent knows which contract to analyze, the protocol agent is started manually, and they meet in a pre-configured room. In a real system, three things need to happen before a Mnemo room opens:

1. The agent must **discover** which protocols want audits.
2. The agent must **connect** to a protocol's representative.
3. Both sides must **verify** the other's identity before entering a private room.

This document designs the minimal infrastructure to make that work, with a pragmatic eye on what we can build in two days.

---

## 2. Protocol Discovery

### 2.1 On-Chain Registry (MnemoRegistry)

A simple contract on Base where protocols advertise that they want security audits. This is the canonical discovery mechanism.

```
MnemoRegistry (Base)
  |
  |-- Protocol[] listings
  |     |-- owner: address (protocol multisig or deployer)
  |     |-- target: address (the contract to be audited)
  |     |-- metadataURI: string (IPFS CID -> bounty terms + source)
  |     |-- maxBounty: uint256 (total pot in wei)
  |     |-- active: bool
  |     |-- teeEndpoint: string (URL of the TEE hosting the protocol's agent)
  |
  |-- Events
        |-- ProtocolRegistered(id, owner, target, metadataURI, maxBounty)
        |-- ProtocolDeactivated(id)
        |-- ProtocolUpdated(id, metadataURI, maxBounty)
```

The metadata at the IPFS CID contains everything the researcher agent needs to decide whether to analyze the target:

```json
{
  "name": "ExampleLending",
  "chain": "base",
  "contracts": [
    {
      "address": "0x...",
      "name": "LendingPool",
      "sourceCodeCID": "QmSourceCode...",
      "compiler": "solc 0.8.24",
      "verified": true
    }
  ],
  "bountyTerms": {
    "critical": { "min": "10000000000000000000", "max": "100000000000000000000" },
    "high":     { "min": "5000000000000000000",  "max": "50000000000000000000" },
    "medium":   { "min": "1000000000000000000",  "max": "10000000000000000000" },
    "low":      { "min": "100000000000000000",   "max": "1000000000000000000" }
  },
  "scope": "All contracts in the LendingPool system. Excludes governance and token contracts.",
  "exclusions": ["known-issues.md CID"],
  "deadline": "2026-06-01T00:00:00Z",
  "contactEndpoint": "https://tee.example.com/mnemo"
}
```

### 2.2 Discovery Flow

The researcher agent uses **event-based pull**:

1. On startup, the agent reads all `ProtocolRegistered` events from genesis (or a checkpoint block).
2. It filters by `active == true` and builds a local index of available targets.
3. It subscribes to new `ProtocolRegistered` events for ongoing discovery.
4. It prioritizes targets by a scoring function: `score = maxBounty * contractComplexity * (1 / existingAuditCount)`.

This is pull, not push. The agent decides what to look at. The protocol merely advertises availability.

### 2.3 Why Not ENS / Off-Chain API?

**ENS subdomains** (e.g., `security.uniswap.eth`) are elegant but add an unnecessary dependency. ENS resolution adds latency and complexity. The registry contract is simpler and gives us event-based discovery for free.

**Off-chain API** (agent polls a REST endpoint) introduces a centralized point of failure and trust. The whole point of on-chain registration is that the protocol's commitment is verifiable and immutable. An API can lie, go down, or be censored.

### 2.4 Why Not Just Scan All Contracts?

The ethical hacker agent _could_ scan all deployed contracts without a registry (it has read-only RPC access). But that creates a problem: if the agent finds a bug in a protocol that has no bounty program and no Mnemo presence, there is no one to negotiate with. The registry ensures the agent only targets protocols that have opted in, have committed bounty terms, and have a reachable endpoint for negotiation.

For the autonomous agent that hunts in the wild (Model A from the ethical hacker design), the registry is a prioritization tool, not a hard constraint. The agent might analyze any contract but will only attempt disclosure for protocols with registry entries or known bounty programs.

---

## 3. Connection Protocol

### 3.1 Architecture: The TEE as Matchmaker

Neither the researcher agent nor the protocol team runs a server that the other connects to directly. Instead:

```
Researcher Agent (TEE A)          Mnemo TEE Gateway           Protocol Agent (TEE B)
      |                                  |                           |
      |-- disclosure_intent(id) -------->|                           |
      |                                  |-- notify(intent) -------->|
      |                                  |<-- accept/reject ---------|
      |<-- room_created(roomId) ---------|                           |
      |                                  |                           |
      |============== Mnemo Room (inside TEE Gateway) ===============|
      |                                  |                           |
```

The TEE Gateway is the shared infrastructure. Both agents connect to it. It:

- Receives disclosure intents from researcher agents.
- Notifies protocol agents of incoming intents.
- Creates Mnemo rooms when both parties agree to negotiate.
- Hosts the room state machine and enforces the protocol.

This avoids the "does the protocol run a server?" problem. The protocol runs an agent that connects to the Mnemo TEE Gateway and listens for incoming disclosure intents. The gateway is the rendezvous point.

### 3.2 Disclosure Intent

When the researcher agent finds a vulnerability, it does not immediately enter a room. It submits a **disclosure intent** -- a lightweight signal that says "I found something in your contracts."

```
DisclosureIntent {
  researcherAgentId: uint256      // ERC-8004 token ID
  protocolId: uint256             // MnemoRegistry listing ID
  severityHint: "Critical" | "High" | "Medium" | "Low"
  componentHint: string           // e.g., "liquidation logic" (deliberately vague)
  attestation: bytes              // TEE attestation proving the agent's identity
  timestamp: uint256
}
```

The intent reveals almost nothing: "an attested agent found something, probably in this component, at this severity." No details. No PoC. The protocol's agent decides whether to accept and enter a room.

### 3.3 Why Not On-Chain Intent?

Putting the disclosure intent on-chain would reveal that a specific protocol has a reported vulnerability before the negotiation even starts. This is an information leak. Front-runners and attackers watch the chain. A `DisclosureIntent` event for Protocol X would signal "someone found a bug in X" to the entire world.

The intent is transmitted through the TEE Gateway (encrypted, attested channel). Only the protocol's agent sees it. If the protocol rejects, nothing is visible to anyone.

### 3.4 The Handshake

```
1. Researcher agent submits DisclosureIntent to TEE Gateway
2. Gateway verifies researcher's TEE attestation
3. Gateway routes intent to the protocol agent (identified by protocolId -> teeEndpoint)
4. Protocol agent evaluates:
   - Is this agent reputable? (check ERC-8004 reputation)
   - Is the severity worth engaging? (compare against bounty terms)
   - Is the component in scope? (compare against metadata)
5a. Protocol agent accepts -> Gateway creates a Mnemo room, both agents enter
5b. Protocol agent rejects -> researcher is notified, no room created
```

The protocol agent can apply its own heuristics for filtering. An agent with zero reputation claiming a critical bug might be required to post a small stake (anti-spam deposit returned on valid submission). An agent with a strong track record gets in immediately.

### 3.5 Hackathon Simplification

For the demo, the TEE Gateway is the same TEE instance that hosts both agents. There is no network routing. The intent is an in-process function call:

```
ResearcherAgent.findBug()
  -> DisclosureIntent
  -> TEE routes to ProtocolAgent
  -> ProtocolAgent.accept()
  -> Room.create()
  -> negotiation
```

This collapses the entire connection protocol into a single process. The design above describes the production architecture; the demo proves the concept with a simplified version.

---

## 4. Identity and Trust

### 4.1 Researcher Identity (Already Solved)

ERC-8004 token on Base. The agent's identity is the triangle:

- ERC-8004 token (on-chain, stores manifest URI and metadata)
- Docker image hash (deterministic build, auditable code)
- TEE attestation (proof of execution environment)

The researcher presents its TEE attestation as part of the disclosure intent. The gateway and the protocol agent can verify it.

### 4.2 Protocol Identity (New Problem)

How does the protocol prove it controls the contracts listed in the registry? This is important because:

- A malicious actor could register contracts they do not control, creating fake bounties to waste agent resources.
- The researcher agent needs to know that the entity negotiating in the room actually has authority to pay the bounty.

**Solution: ownership proof at registration time.**

When a protocol registers in MnemoRegistry, it must prove ownership of the target contracts. Three mechanisms, in order of preference:

1. **Direct owner()**: If the target contract has an `owner()` function, the registry requires `msg.sender == target.owner()`. This is a simple on-chain check.

2. **CREATE2 deployer**: The registry accepts proof that the registrant deployed the contract. This is verified by checking the CREATE2 address derivation or by checking the deployer address from the contract's creation transaction (off-chain, verified by the TEE).

3. **Multisig signature**: For contracts owned by multisigs (Gnosis Safe, etc.), the registrant submits a signed message from the multisig. The registry verifies the signature on-chain.

For the hackathon, we use option 1 only: `require(Ownable(target).owner() == msg.sender)`. This covers most simple contracts and all the DVDeFi challenge contracts.

### 4.3 Protocol Agent Identity

The protocol also runs an agent inside a TEE (or connects to the shared TEE Gateway). Its agent needs identity too:

- The protocol agent is registered as an ERC-8004 token, linked to the protocol's registry entry.
- The registry stores the protocol's agent ID alongside the listing.
- When the protocol agent connects to the gateway, it presents its TEE attestation.

**For the hackathon**: The protocol agent is a simple deterministic agent (not LLM-powered) that verifies PoCs against invariants and accepts/rejects based on pre-configured rules. Its "identity" is the deployer address of the contracts. No separate ERC-8004 token needed for the protocol agent in the demo.

### 4.4 Mutual Attestation in the Room

Before negotiation begins, both agents verify each other's TEE attestation. This is already specified in `spec/protocol.md` (session lifecycle, step 3: Handshake). The attestation exchange proves:

- Researcher agent: "I am running this specific Docker image in a real TEE. Here is my ERC-8004 identity. Here is my attestation report."
- Protocol agent: "I am authorized by the protocol owner. Here is my attestation (or, in the hackathon, here is the owner's signature)."

The attestation is verified by the TEE Gateway before the room opens. Neither agent can enter without valid attestation.

---

## 5. Complete Message Flow

### Step by Step

```
Phase 1: Discovery
  1. Protocol calls MnemoRegistry.register(target, metadataURI, maxBounty)
     -> ProtocolRegistered event emitted
     -> Protocol agent connects to TEE Gateway, presents attestation
     -> Protocol agent enters "listening" state

  2. Researcher agent reads ProtocolRegistered events from MnemoRegistry
     -> Builds target list, prioritizes by bounty size and complexity
     -> Fetches metadata from IPFS (contract source, bounty terms, scope)

Phase 2: Analysis (off-chain, inside researcher's TEE)
  3. Agent fetches target contract bytecode via read-only RPC
  4. Agent runs Slither (static analysis) -> identifies potential patterns
  5. Agent forks chain via Anvil, writes invariant tests, runs Echidna
  6. Agent constructs PoC on local fork, verifies it works
  7. Agent assesses severity based on impact (extractable value, affected users)

Phase 3: Connection
  8. Agent submits DisclosureIntent to TEE Gateway:
     { researcherAgentId, protocolId, severityHint: "Critical",
       componentHint: "withdrawal logic", attestation }
  9. Gateway verifies researcher attestation, routes intent to protocol agent
  10. Protocol agent evaluates intent:
      - Check researcher reputation (ERC-8004 feedback count/score)
      - Check severity vs bounty terms (Critical -> max 100 ETH, worth engaging)
      - Check component is in scope ("withdrawal logic" is covered)
  11. Protocol agent accepts -> Gateway creates Mnemo room

Phase 4: Negotiation (inside Mnemo room, standard protocol)
  12. [main] Researcher agent sends metadata message:
      "I found a critical vulnerability in the withdrawal logic of
       LendingPool at 0x... It allows unauthorized fund extraction."

  13. [main] Protocol agent responds:
      "We acknowledge. Our bounty terms for Critical are 10-100 ETH.
       Please provide details for verification."

  14. Researcher agent opens scope(R) with reveal:
      "The withdrawAll() function does not check re-entrancy guards
       when called through the fallback. An attacker can drain the pool
       in a single transaction. Affected: approximately 500 ETH TVL."

  15. [scope(R)] Protocol agent evaluates the claim:
      - Runs the described scenario against its own invariants
      - Checks for duplicates (has this pattern been reported before?)

  16. [scope(R)] Protocol agent opens scope(P) with counter-reveal:
      "Verified. Our assessment: High severity (not Critical, because
       the fallback path requires a specific token configuration).
       Proposed payout: 25 ETH."

  17. [scope(R) > scope(P)] Researcher agent evaluates:
      - Disagrees on severity classification
      - "I can demonstrate full drain regardless of token configuration.
         Counter-proposal: 50 ETH. I will provide the complete PoC
         for your verification."

  18. [scope(R) > scope(P)] Protocol agent:
      - "Accepted at 40 ETH, contingent on PoC verification."

  19. Both agents promote scope(P) -> scope(R)
  20. Both agents promote scope(R) -> main
  21. Deal terms crystallized on main: 40 ETH, severity High, PoC pending

Phase 5: Verification and Settlement
  22. TEE creates MnemoEscrow on-chain:
      create(funder=protocol, payee=researcher, amount=40 ETH,
             deadline=now+48h, commitHash=keccak256(roomId||nonce))
      -> EscrowCreated event

  23. Protocol funds escrow:
      fund(escrowId) with 40 ETH
      -> EscrowFunded event

  24. Researcher agent provides full PoC inside a new scope(R2):
      - Foundry test contract
      - Fork block number
      - Expected output (drain amount)

  25. Protocol agent (or TEE verifier) runs PoC:
      - Forks chain at specified block
      - Deploys and executes the PoC
      - Verifies the claimed impact matches

  26. Verification passes. Both agents commit:
      commit(terms={ severity: "High", payout: 40 ETH,
                     escrowId, pocHash: keccak256(poc) })

  27. TEE resolves escrow:
      release(escrowId)
      -> 40 ETH sent to researcher's payee address
      -> EscrowReleased event

Phase 6: Reputation
  28. TEE posts reputation via MnemoReputation:
      - Researcher gets: severity=High, payout=40 ETH, verified=true
      - Protocol gets: outcome=resolved, timely=true
      Both linked to their ERC-8004 identities.

  29. Room state is destroyed. Only the on-chain artifacts remain:
      - Escrow record (Created -> Funded -> Released)
      - Reputation entries
      - Deal commit hash (verifiable but opaque)
```

### Failure Paths

```
F1: Protocol rejects intent
    -> No room created. Researcher is notified. No information leaks.

F2: Negotiation fails (severity disagreement)
    -> Either party aborts. Room state destroyed. No escrow was created.

F3: Escrow funded but verification fails
    -> TEE calls refund(escrowId). Protocol gets money back.

F4: Escrow funded but TEE goes offline
    -> After deadline, anyone calls claimExpired(escrowId).
       Protocol gets automatic refund. Already handled by MnemoEscrow.

F5: Researcher scope-closes after revealing details
    -> Scope content destroyed. Protocol agent's next context has no
       access to the revealed details. TEE enforces this.

F6: Duplicate vulnerability
    -> Protocol agent detects duplicate during step 15 (checks against
       prior disclosures). Responds with "duplicate, already patched/known."
       Researcher can abort or dispute.
```

---

## 6. Practical Architecture for the Hackathon

### 6.1 What We Build (2 Days)

**Tier 1: Must have for demo**

- `MnemoRegistry.sol` -- simple registry contract (see section 7). Deploy to Base Sepolia.
- Registry client in `@mnemo/chain` -- Effect service matching the existing pattern (Escrow, Erc8004).
- Hardcoded discovery in the researcher agent: reads one registry entry, analyzes one target (Side Entrance from DVDeFi).
- Single TEE instance hosts everything: researcher agent, protocol agent, room, verifier.
- The "connection" is an in-process call: researcher finds bug, creates intent, protocol accepts, room opens.

**Tier 2: Nice to have**

- Event-based discovery: researcher agent watches for `ProtocolRegistered` events.
- Protocol agent that actually evaluates the disclosure intent (checks reputation, severity, scope).
- IPFS metadata upload for protocol registration (using existing `uploadProtocolMetadata` from `@mnemo/chain`).

**Tier 3: Out of scope**

- Multi-TEE architecture (separate TEEs for researcher and protocol).
- P2P connection between TEEs.
- Anti-spam staking for low-reputation agents.
- Duplicate detection (requires private set membership, e.g., OPRF).

### 6.2 What We Simulate

| Component | Real | Simulated |
|-----------|------|-----------|
| Registry contract | Deployed on Base Sepolia | -- |
| Protocol metadata | IPFS CID (or inline for demo) | -- |
| TEE attestation | dstack simulator | Real TEE |
| Researcher analysis | Foundry + Slither on DVDeFi | Autonomous target selection |
| Connection/routing | In-process function call | TEE Gateway network routing |
| Escrow | MnemoEscrow on Base Sepolia | -- |
| Reputation | MnemoReputation on Base Sepolia | -- |

### 6.3 Demo Narrative

The demo walks through the complete flow in one shot:

1. "Here is a protocol registered on Base Sepolia with a bug bounty" (show registry tx)
2. "The ethical hacker agent discovers it, analyzes the contracts" (show analysis output)
3. "It finds a vulnerability and opens a disclosure" (show intent)
4. "Both agents enter a Mnemo room and negotiate" (show room messages with scoped reveals)
5. "They agree on terms, escrow is funded and released" (show on-chain txs)
6. "Both agents get reputation" (show ERC-8004 entries)

Total on-chain artifacts visible to judges: registry entry, escrow lifecycle, reputation entries. All on Base Sepolia with real transactions.

---

## 7. Base Contract Design

### 7.1 MnemoRegistry

```solidity
// MnemoRegistry.sol — Protocol registration for Mnemo bug disclosure network.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MnemoRegistry {

    struct Protocol {
        address owner;          // Protocol multisig or deployer
        address target;         // Primary contract to be audited
        string metadataURI;     // IPFS CID -> bounty terms, source, scope
        uint256 maxBounty;      // Maximum bounty in wei (total pot)
        bool active;            // Can be deactivated by owner
    }

    uint256 public nextProtocolId;
    mapping(uint256 => Protocol) public protocols;

    // -- Events --
    event ProtocolRegistered(
        uint256 indexed protocolId,
        address indexed owner,
        address indexed target,
        string metadataURI,
        uint256 maxBounty
    );
    event ProtocolDeactivated(uint256 indexed protocolId);
    event ProtocolUpdated(uint256 indexed protocolId, string metadataURI, uint256 maxBounty);

    // -- Errors --
    error NotOwner();
    error ZeroBounty();
    error AlreadyInactive();

    // -- Registration --

    /// @notice Register a protocol for auditing. Caller becomes owner.
    /// @dev For hackathon: no ownership proof of target contract.
    ///      Production: require Ownable(target).owner() == msg.sender.
    function register(
        address target,
        string calldata metadataURI,
        uint256 maxBounty
    ) external returns (uint256 protocolId) {
        if (maxBounty == 0) revert ZeroBounty();

        protocolId = nextProtocolId++;
        protocols[protocolId] = Protocol({
            owner: msg.sender,
            target: target,
            metadataURI: metadataURI,
            maxBounty: maxBounty,
            active: true
        });

        emit ProtocolRegistered(protocolId, msg.sender, target, metadataURI, maxBounty);
    }

    // -- Management --

    function deactivate(uint256 protocolId) external {
        Protocol storage p = protocols[protocolId];
        if (msg.sender != p.owner) revert NotOwner();
        if (!p.active) revert AlreadyInactive();
        p.active = false;
        emit ProtocolDeactivated(protocolId);
    }

    function update(uint256 protocolId, string calldata metadataURI, uint256 maxBounty) external {
        Protocol storage p = protocols[protocolId];
        if (msg.sender != p.owner) revert NotOwner();
        if (maxBounty == 0) revert ZeroBounty();
        p.metadataURI = metadataURI;
        p.maxBounty = maxBounty;
        emit ProtocolUpdated(protocolId, metadataURI, maxBounty);
    }

    // -- View --

    function getProtocol(uint256 protocolId) external view returns (Protocol memory) {
        return protocols[protocolId];
    }
}
```

### 7.2 Bounty Terms Structure

Bounty terms live in the IPFS metadata, not on-chain. On-chain, only `maxBounty` is stored (the ceiling). This keeps the contract simple and gas-cheap while allowing rich bounty structures off-chain.

The on-chain `maxBounty` serves as a signal to agents: "this protocol is willing to pay up to X." The detailed per-severity terms in the IPFS metadata are what the agents negotiate against inside the room.

Why per-severity ranges instead of fixed amounts:

- **Ranges enable negotiation.** "Critical: 10-100 ETH" means the researcher and protocol can agree on a specific amount within the range based on actual impact. A critical bug that drains 100 ETH TVL and one that drains 10,000 ETH TVL are both critical, but different in impact.
- **Fixed amounts create adversarial severity classification.** If Critical = 100 ETH and High = 25 ETH, the researcher will always argue Critical and the protocol will always argue High. Ranges let them meet in the middle.

### 7.3 Registry-Escrow Interaction

The registry and escrow are independent contracts. They interact through the TEE:

```
MnemoRegistry                    TEE                         MnemoEscrow
     |                            |                               |
     |-- getProtocol(id) -------->|                               |
     |                            |-- (negotiation in room) ----->|
     |                            |                               |
     |                            |-- create(funder, payee,       |
     |                            |      amount, deadline,        |
     |                            |      commitHash) ------------>|
     |                            |                               |
```

The TEE reads the registry to get protocol metadata. After negotiation, the TEE creates the escrow. The registry does not call the escrow and the escrow does not call the registry. The TEE is the bridge.

This separation is intentional:

- The registry is a public directory. Anyone can read it.
- The escrow is a private settlement mechanism. The commitment hash is opaque.
- Linking them on-chain would reveal which registry entry a particular escrow is for, leaking information about which protocols have active disclosures.

### 7.4 Event-Based Discovery

Agents discover protocols by watching events:

```
// Agent startup
1. Read all ProtocolRegistered events from block 0 (or checkpoint)
2. Filter by active == true
3. Build local index: { protocolId -> Protocol }

// Ongoing
4. Subscribe to new ProtocolRegistered events
5. Subscribe to ProtocolDeactivated events (remove from index)
6. Subscribe to ProtocolUpdated events (update metadata)
```

This is a standard pattern for on-chain indexing. The agent does not need a subgraph or external indexer -- it reads events directly from the RPC, which it already has access to.

---

## 8. Open Questions

### 8.1 Who Runs the Protocol Agent?

In the hackathon demo, the TEE runs the protocol agent. But in production, who operates the protocol's side?

Options:
- **Protocol team runs their own agent** in their own TEE. Most flexible but highest setup cost. Unlikely for most DeFi teams.
- **Mnemo gateway runs a default protocol agent.** The protocol configures it via the IPFS metadata (bounty terms, scope, invariants). The gateway agent follows the rules mechanically. This is the most practical option.
- **Third-party agent operators.** Companies that specialize in running protocol-side agents, similar to how audit firms operate today. Future ecosystem play.

For the hackathon, option 2: the TEE gateway runs a simple protocol agent that evaluates claims against invariants and negotiates within the bounty range.

### 8.2 How Does the Protocol Agent Verify Claims?

The protocol agent needs to run the researcher's PoC to verify it works. This means the protocol agent needs:

- Access to an Anvil fork of the target chain.
- The ability to compile and run Foundry tests.
- Invariant definitions for the target contracts.

This is exactly what `@mnemo/dvdefi` and `@mnemo/verifier` already provide. The protocol agent uses the existing verification pipeline: forge build, forge test, invariant checks.

### 8.3 Privacy of Registry Entries

Registering on the MnemoRegistry is a public signal: "we have a bug bounty and want audits." This is fine -- bug bounty programs are already public (ImmuneFi listings are public). The registry is equivalent to a bounty platform listing.

What must NOT be public: which protocols have active disclosures, what severity, what component. This is why disclosure intents go through the TEE, not on-chain. The registry is public. The negotiation is private.

### 8.4 Anti-Spam

What stops a low-quality agent from spamming disclosure intents to every protocol?

- **Reputation filter**: Protocol agents can require minimum reputation scores (ERC-8004 feedback count/value) before accepting intents.
- **Stake requirement**: The registry could require researchers to stake a small amount when submitting an intent, refunded on valid submission, slashed on spam. Not implementing for hackathon.
- **Rate limiting**: The TEE gateway can rate-limit intents per agent per time window. Simple and effective.

For the hackathon: no anti-spam. The demo has one researcher and one protocol.
