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

### 3.1 Architecture: Escrow-Gated TEE Room

Neither the researcher agent nor the protocol team runs a server that the other connects to directly. Instead:

```
Researcher Agent (TEE A)          Mnemo TEE Gateway           Protocol (on-chain)
      |                                  |                           |
      |-- disclosure_intent(id) -------->|                           |
      |                                  |-- notify(intent) -------->|
      |                                  |   (encrypted channel)     |
      |                                  |                           |
      |                                  |   Protocol funds escrow   |
      |                                  |<-- EscrowFunded event ----|
      |<-- room_opened(roomId) ---------|                           |
      |                                  |                           |
      |============== Mnemo Room (inside TEE Gateway) ===============|
      |   Researcher submits exploit     |                           |
      |   TEE runs forge verification    |                           |
      |   Forge passes → auto-release    |                           |
      |   Forge fails  → auto-refund     |                           |
```

The TEE Gateway is the shared infrastructure. The key design decision: **escrow is the access control mechanism**. The protocol does not accept or reject the disclosure intent -- it funds escrow or ignores it. Funding escrow is the gate that opens the TEE room.

The TEE Gateway:

- Receives disclosure intents from researcher agents.
- Notifies protocols of incoming intents via encrypted channel.
- Watches for `EscrowFunded` events -- this is the trigger that opens the room.
- Hosts the TEE room where the researcher submits exploit code.
- Runs forge verification against a pinned block fork.
- Auto-releases or auto-refunds escrow based on forge result. No human decision.

This avoids the "does the protocol run a server?" problem. The protocol does not need to run an agent at all for the hackathon flow -- it just needs to fund escrow on-chain. The gateway watches for the funding event and opens the room automatically.

### 3.2 Disclosure Intent

When the researcher agent finds a vulnerability, it does not immediately enter a room. It submits a **disclosure intent** -- a lightweight signal that says "I found something in your contracts."

```
DisclosureIntent {
  researcherAgentId: uint256      // ERC-8004 token ID
  protocolId: uint256             // MnemoRegistry listing ID
  targetAddress: address          // The specific contract a finding was identified in
                                  // Only safe because this goes through the private TEE gateway channel —
                                  // if this were on-chain, even the address would leak "someone found a bug in contract X"
  attestation: bytes              // TEE attestation proving the agent's identity
  pinnedBlock: uint256            // Block number at intent time — fork snapshot for verification
  timestamp: uint256
}
```

The intent reveals almost nothing: "an attested agent found something in contract X." No severity. No component hint. No details. No PoC.

**Critical: the block number is pinned at intent time.** This prevents the protocol from patching the vulnerability after learning a disclosure exists and then claiming the exploit is invalid. The forge verification inside the TEE will fork at this pinned block, not the current block.

The protocol's only decision after receiving the intent is whether to fund escrow. There is no accept/reject button. Funding escrow is the acceptance signal. No escrow = no details revealed. The researcher's agent waits for the `EscrowFunded` event before entering the room.

### 3.3 Why Not On-Chain Intent?

Putting the disclosure intent on-chain would reveal that a specific protocol has a reported vulnerability before the negotiation even starts. This is a catastrophic information leak.

A `DisclosureIntent` event for Protocol X would signal "someone found a bug in X" to the entire world. Front-runners would immediately short the token. Attackers would scrutinize the protocol to find and exploit the bug themselves before it can be patched. **EVEN THE TARGET ADDRESS IS A LEAK.** An on-chain event saying "vulnerability in contract 0x123..." immediately tells everyone that 0x123 is vulnerable—the public can read its code, fork the chain, and replay the exploit.

The intent is transmitted through the TEE Gateway (encrypted, attested channel) instead. Only the protocol's agent sees it. If the protocol rejects, nothing is visible to anyone. The only on-chain record of a disclosed vulnerability is the final settlement (escrow, reputation) which is intentionally opaque: the commit hash is a hash, not the vulnerability details.

### 3.4 The Escrow Gate

```
1. Researcher agent submits DisclosureIntent to TEE Gateway
   (includes: agentId, protocolId, targetAddress, pinnedBlock, attestation)
2. Gateway verifies researcher's TEE attestation
3. Gateway notifies protocol via encrypted channel:
   "Agent X (ERC-8004 #123, reputation: 5 verified criticals) has a finding
    for contract 0x... in your listing. Fund escrow to receive details."
4. Protocol evaluates (off-chain, human or automated decision):
   - Is this agent reputable? (check ERC-8004 on-chain records)
   - Is the targetAddress a contract in scope?
   - Is the bounty program still active and funded?
5a. Protocol funds MnemoEscrow -> EscrowFunded event
    -> Gateway opens TEE room
    -> Researcher submits exploit code inside TEE
    -> TEE runs forge test against fork at pinnedBlock
    -> Forge passes -> escrow AUTO-RELEASES to researcher
    -> Forge fails  -> escrow AUTO-REFUNDS to protocol
5b. Protocol does not fund escrow within deadline
    -> Intent expires. No information revealed. Researcher moves on.
```

There is no accept/reject decision from the protocol. There is no negotiation on severity or payout amount (for the hackathon). The escrow amount is the bounty listed in the registry. The forge result is the arbiter. This removes the entire dispute resolution layer.

### 3.5 Hackathon Simplification

For the demo, the TEE Gateway is the same TEE instance that hosts the researcher agent. There is no protocol agent -- the protocol is a human (or script) that funds escrow on-chain. The flow is:

```
ResearcherAgent.findBug()
  -> DisclosureIntent (pinned block recorded)
  -> Protocol notified via encrypted channel
  -> Protocol funds escrow on-chain
  -> EscrowFunded event detected
  -> TEE room opens
  -> Researcher submits exploit code
  -> TEE runs forge test at pinned block
  -> Forge passes -> auto-release
  -> Forge fails  -> auto-refund
```

This eliminates the need for a protocol agent entirely. The protocol's only action is funding escrow. Everything else is automated by the TEE and smart contracts.

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

**Solution: flexible relationship proof at registration time.**

The naive approach is `require(Ownable(target).owner() == msg.sender)`. This fails in practice for several common cases:

- **Burned admin key**: Protocols that renounced ownership after deployment have no `owner()` to check against.
- **Proxy admin pattern**: The `owner()` of a proxy is the proxy admin contract, not the protocol multisig. The multisig controls the admin contract, but a direct `owner()` check returns the wrong address.
- **CREATE2 deployer discarded**: Many factory-deployed contracts have a deployer address that was a one-time deployment key, not the ongoing operator.
- **Rotating Safe signers**: A Gnosis Safe's signer set can rotate after deployment. The current signers may differ from whoever originally called `owner()`.

**Recommended approach: EIP-712 signature + on-chain relationship proof.**

The registrant signs an EIP-712 message attesting to the registration. Separately, they provide a proof that their signing address has a recognized relationship to the target contract. The registry accepts multiple proof types:

1. **owner() match**: `target.owner() == signer`. Simple on-chain call. Covers Ownable contracts where ownership has not been transferred to a proxy admin.

2. **AccessControl admin role**: `target.hasRole(DEFAULT_ADMIN_ROLE, signer)`. Covers OpenZeppelin AccessControl patterns.

3. **Safe signer**: The signer is a current signer in a Gnosis Safe that controls the contract. Verified by calling `GnosisSafe(safeAddress).isOwner(signer)` and confirming the Safe is the contract's owner or admin.

4. **Deployer proof**: The contract's creation transaction originated from `signer`. This is verified off-chain by the TEE (reads the creation tx from RPC) and submitted as a signed attestation. Covers CREATE2-deployed contracts and factory patterns.

5. **Custom verifier**: The target contract implements a `MnemoOwnershipProof` interface that returns true for the claimed registrant. Opt-in for protocols that want explicit Mnemo support.

The registry contract stores which proof type was used. Agents and verifiers can inspect this and weight their trust accordingly — a Safe-signer proof on a proxy-controlled contract is stronger evidence than a deployer proof on a discarded key.

**For the hackathon**, we use proof type 1 only: `require(Ownable(target).owner() == msg.sender)`. This covers all the DVDeFi challenge contracts. The design above is documented as the production target so that the registry contract can be extended without a breaking change — proof type is stored alongside the listing, and new types can be added as the registry evolves.

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

## 5. Complete Message Flow (Hackathon Happy Path)

### Step by Step

```
Phase 1: Discovery
  1. Protocol calls MnemoRegistry.register(target, metadataURI, maxBounty)
     -> ProtocolRegistered event emitted

  2. Researcher agent polls MnemoRegistry.nextProtocolId() to discover new listings
     -> Fetches protocol metadata (contract source, bounty terms, scope)
     -> Prioritizes targets by bounty size and complexity

Phase 2: Analysis (inside researcher's TEE)
  3. Agent fetches target contract source (verified source or bytecode via RPC)
  4. Agent sends source to LLM (DeepSeek via Redpill) for vulnerability analysis
  5. Agent constructs PoC as a Foundry test on local Anvil fork
  6. Agent verifies PoC passes locally

Phase 3: Disclosure Intent
  7. Agent submits DisclosureIntent to TEE Gateway:
     { researcherAgentId, protocolId, targetAddress, pinnedBlock, attestation }
     pinnedBlock = current block at intent time (snapshot for verification)
  8. Gateway verifies researcher's TEE attestation
  9. Gateway creates MnemoEscrow on-chain:
     create(funder=protocol, payee=researcher, amount=maxBounty,
            deadline=now+48h, commitHash=keccak256(intentId))
     -> EscrowCreated event
  10. Protocol is notified via encrypted channel:
      "Agent X has a finding for your contract. Fund escrow to receive details."

Phase 4: Escrow Gate
  11. Protocol funds escrow:
      fund(escrowId) with maxBounty
      -> EscrowFunded event
      THIS IS THE GATE. No funding = no details = researcher moves on.

Phase 5: Verification (inside TEE room, automated)
  12. EscrowFunded event detected -> TEE room opens
  13. Researcher agent submits exploit code (Foundry test) inside TEE
  14. TEE runs forge verification:
      - Forks chain at pinnedBlock (the block from DisclosureIntent time)
      - Deploys and executes the researcher's Foundry test
      - forge test must PASS for the exploit to be considered valid

  15a. Forge PASSES:
       -> Escrow AUTO-RELEASES to researcher's payee address
       -> EscrowReleased event
       -> No human decision. Forge result is final.

  15b. Forge FAILS:
       -> Escrow AUTO-REFUNDS to protocol
       -> EscrowRefunded event
       -> No human decision. Forge result is final.

Phase 6: Reputation
  16. TEE posts reputation via MnemoReputation:
      - Researcher gets: verified=true/false, payout amount, timestamp
      Both linked to their ERC-8004 identities.

  17. Room state is destroyed. Only the on-chain artifacts remain:
      - Escrow record (Created -> Funded -> Released/Refunded)
      - Reputation entries
      - Commitment hash (verifiable but opaque)
```

### Failure Paths (Hackathon Scope)

```
F1: Protocol does not fund escrow
    -> Intent expires after deadline. No room created. No information leaks.
       Researcher moves on to next target.

F2: Escrow funded but forge verification fails
    -> Escrow AUTO-REFUNDS to protocol. No human decision needed.

F3: Escrow funded but TEE goes offline
    -> After deadline, anyone calls claimExpired(escrowId).
       Protocol gets automatic refund. Already handled by MnemoEscrow.

F4: Protocol patches contract after seeing DisclosureIntent
    -> Irrelevant. Forge runs against pinnedBlock (snapshot from intent time).
       The patch does not affect verification. This is the purpose of block pinning.
```

### What Is NOT in the Hackathon Flow

The following are deliberately excluded from the happy path and acknowledged as future work:

- **Severity negotiation**: The escrow amount is the registry's maxBounty. No negotiation on severity tiers.
- **Protocol reject/accept**: The protocol's only action is funding escrow. There is no reject button.
- **Dispute resolution**: Forge result is final. No appeals, no DAO governance, no arbitration.
- **Scoped reveals / negotiation turns**: The room is not a negotiation -- it is a submission and automated verification step.
- **Duplicate detection**: Not handled. If two agents find the same bug, both get paid if both pass forge.

---

## 6. Practical Architecture for the Hackathon

### 6.1 Demo Components (Must Work)

**On-Chain (Base Sepolia)**

- `MnemoRegistry` -- protocol registration (see section 7). Agent discovers targets by polling `nextProtocolId`.
- `MnemoEscrow` -- escrow with auto-release/auto-refund. The TEE calls `release()` or `refund()` based on forge result. No human decision.
- `ERC-8004` -- agent identity. Researcher agent has an on-chain identity bound to Docker image hash + TEE attestation.

**TEE (Phala dstack)**

- Phala CVM running the researcher agent, forge, Anvil.
- Forge verification against a fork at pinned block (snapshot from DisclosureIntent time).
- RPC proxy (read-only allowlist) preventing the agent from signing transactions.
- TEE attestation flow (simulated for demo, real for Phala Cloud deployment).

**Agent**

- Polls MnemoRegistry for new protocol listings.
- Fetches and analyzes contract source via LLM (DeepSeek via Redpill).
- Constructs and verifies PoC as a Foundry test.
- Submits DisclosureIntent with pinned block.
- Waits for EscrowFunded event, then submits exploit to TEE room.

**Encrypted Artifacts**

- PoC code and analysis artifacts stored on IPFS, encrypted via Lit Protocol access conditions.
- Lit condition: escrow must be funded (on-chain check) for decryption key release.
- Fallback if Lit integration is not ready: EIP-712 signature-gated access.

### 6.2 What We Simulate

| Component | Real | Simulated |
|-----------|------|-----------|
| Registry contract | Deployed on Base Sepolia | -- |
| Escrow (auto-release) | Deployed on Base Sepolia | -- |
| ERC-8004 identity | Deployed on Base Sepolia | -- |
| TEE attestation | dstack simulator | Real TEE (Phala Cloud stretch goal) |
| Registry polling | Real (reads nextProtocolId) | -- |
| LLM analysis (DeepSeek) | Real (via Redpill) | -- |
| Forge verification | Real (forge test at pinned block) | -- |
| Pinned block fork | Real (Anvil fork at DisclosureIntent block) | -- |
| Escrow auto-release | Real (TEE calls release on forge pass) | -- |
| Lit Protocol encryption | Stretch goal | Falls back to signature gating |
| IPFS artifact storage | Stretch goal | Inline for demo |

### 6.3 Demo Narrative

The demo walks through the complete flow in one shot:

1. "Here is a protocol registered on Base Sepolia with a bug bounty" (show registry tx, show the `ProtocolRegistered` event)
2. "The agent starts up, polls `nextProtocolId`, discovers this protocol" (show the discovery step -- this is the key moment that distinguishes Mnemo from a hardcoded script)
3. "The agent analyzes the contract source via DeepSeek inside the TEE" (show LLM analysis output)
4. "It finds a vulnerability and submits a DisclosureIntent -- no details, just 'I have a finding' plus a pinned block number" (show intent, explain block pinning)
5. "The protocol is notified. They fund escrow -- this is the gate" (show escrow funding tx)
6. "Escrow funded. The TEE room opens. The researcher submits exploit code" (show submission)
7. "The TEE runs forge against a fork at the pinned block. Forge passes." (show forge output)
8. "Escrow auto-releases to the researcher. No human decision. Forge result is final." (show release tx)
9. "Agent gets reputation on-chain" (show ERC-8004 entries)

Total on-chain artifacts visible to judges: registry entry, escrow lifecycle (Created -> Funded -> Released), reputation entries. All on Base Sepolia with real transactions.

### 6.4 What Is NOT in the Demo

- Protocol agent (the protocol is a human or script that funds escrow)
- Severity negotiation (escrow amount = registry maxBounty, flat)
- Dispute resolution (forge is the arbiter, period)
- Scoped reveals / negotiation turns (room is submit-and-verify, not a conversation)
- Multi-TEE architecture (single TEE instance hosts everything)

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

### 8.1 Privacy of Registry Entries

Registering on the MnemoRegistry is a public signal: "we have a bug bounty and want audits." This is fine -- bug bounty programs are already public (ImmuneFi listings are public). The registry is equivalent to a bounty platform listing.

What must NOT be public: which protocols have active disclosures, what severity, what component. This is why disclosure intents go through the TEE, not on-chain. The registry is public. The verification is private.

### 8.2 Anti-Spam

What stops a low-quality agent from spamming disclosure intents to every protocol?

- **Reputation filter**: The TEE gateway can require minimum reputation scores (ERC-8004 feedback count/value) before accepting intents.
- **Stake requirement**: The registry could require researchers to stake a small amount when submitting an intent, refunded on valid submission (forge passes), slashed on spam (forge fails repeatedly). Not implementing for hackathon.
- **Rate limiting**: The TEE gateway can rate-limit intents per agent per time window. Simple and effective.
- **Economic disincentive**: Submitting invalid exploits wastes the researcher's time but costs the protocol nothing (auto-refund on forge failure).

For the hackathon: no anti-spam. The demo has one researcher and one protocol.

### 8.3 Escrow Amount Flexibility

For the hackathon, escrow amount = registry's `maxBounty`. No negotiation. In production, the escrow amount could be tiered (the researcher's intent could hint at severity, and the protocol funds accordingly). This reintroduces negotiation complexity that we deliberately avoid for the demo.

### 8.4 What If Forge Is Not a Complete Arbiter?

Forge verification is a strong signal but not perfect. Some vulnerabilities:

- Require specific timing or MEV conditions that are hard to reproduce in a fork.
- Involve economic design flaws that are not expressible as a single forge test.
- Depend on cross-protocol interactions that require multi-contract simulation.

For the hackathon, we acknowledge this limitation and scope to vulnerabilities that ARE expressible as forge tests (which covers the vast majority of smart contract bugs). More nuanced verification is future work.

---

## 9. Scope for Hackathon

### In Scope

- MnemoRegistry: protocol registration, agent discovery via `nextProtocolId` polling.
- MnemoEscrow: auto-release on forge pass, auto-refund on forge fail. No human decision.
- ERC-8004: agent identity bound to Docker image hash + TEE attestation.
- TEE: Phala dstack (simulated or real), forge verification at pinned block.
- Agent: polls registry, LLM analysis (DeepSeek), PoC construction, disclosure intent, escrow interaction.
- Block pinning: fork snapshot at DisclosureIntent time prevents patch-then-dispute.

### Out of Scope (Future Work)

- **Dispute resolution**: Deliberately excluded. The forge result is final. Adding dispute resolution opens a DAO/governance rabbit hole that is out of scope. Acknowledged as a real limitation -- some edge cases (forge passing on a non-exploitable pattern, forge failing due to environment differences) need human arbitration in production.
- **Severity negotiation**: Escrow amount is flat (maxBounty). Per-severity tiers reintroduce the negotiation complexity we are avoiding.
- **Protocol agent**: No protocol-side agent in the demo. The protocol is a human or script that funds escrow.
- **Scoped reveals / multi-turn negotiation**: The room is submit-and-verify, not a conversation.
- **Duplicate detection**: If two agents find the same bug, both get paid if both pass forge. Private set membership (OPRF) is needed for real dedup.
- **Anti-spam / staking**: One researcher, one protocol in the demo.
- **Multi-TEE architecture**: Single TEE instance for the demo.
- **On-chain DCAP attestation verification**: Hash comparison only for demo.
