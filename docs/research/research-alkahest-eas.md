# Research: Alkahest (Arkhai) & EAS (Ethereum Attestation Service)

**Date:** 2026-03-15
**Purpose:** Evaluate Arkhai's Alkahest escrow protocol and EAS for Mnemo integration. Assess viability of Arkhai's $450 "Escrow Ecosystem Extensions" bounty.

---

## 1. Alkahest Protocol

### 1.1 What Is It?

Alkahest is an **open-source escrow protocol built on top of EAS** (Ethereum Attestation Service), created by CoopHive (now Arkhai). It provides composable primitives for peer-to-peer agreements: escrow, payment, and arbitration — all represented as EAS attestations.

**Key insight:** Alkahest does NOT use custom escrow contracts in the traditional sense. Instead, every obligation (escrow deposit, payment, job result) is an **EAS attestation**. The contracts are EAS schema resolvers that enforce token locking/transfer when attestations are created. This is architecturally elegant — the entire state of an exchange is a chain of attestations.

**Tagline from Arkhai:** "Making resources liquid — watts, cycles, and information — so autonomous agents can discover, price, allocate, and settle work on one rail."

### 1.2 Architecture

The protocol has three layers:

**Layer 1: Obligation Contracts** (EAS Schema Resolvers)
These are Solidity contracts that register EAS schemas and act as resolvers. When you create an attestation against one of these schemas, the resolver enforces side effects (e.g., locking tokens in escrow).

Obligation types discovered in the codebase:
- `ERC20EscrowObligation` — Lock ERC20 tokens, specify arbiter + demand
- `ERC20PaymentObligation` — Direct payment (no escrow, immediate transfer)
- `ERC721EscrowObligation` — Lock NFTs in escrow
- `ERC721PaymentObligation` — Direct NFT payment
- `ERC1155EscrowObligation` / `ERC1155PaymentObligation`
- `TokenBundleEscrowObligation` / `TokenBundlePaymentObligation` — Mixed bundles
- `NativeTokenEscrowObligation` / `NativeTokenPaymentObligation` (planned, not deployed)
- `AttestationEscrowObligation` — Escrow an attestation itself (meta!)
- `StringObligation` — Attest to a string result (e.g., job output CID)
- `JobResultObligation` — Compute job results

Each obligation contract:
1. Registers an EAS schema (e.g., `address token, uint256 amount, address arbiter, bytes demand`)
2. Implements `doObligation()` — called when someone creates an attestation against the schema
3. The resolver logic locks tokens, verifies parameters, etc.

**Layer 2: Arbiter Contracts**
Arbiters decide whether an obligation has been fulfilled. They implement a single interface:

```solidity
// IArbiter.sol
interface IArbiter {
    function checkObligation(
        Attestation memory attestation,  // The fulfillment attestation
        bytes memory demand,              // What was demanded (ABI-encoded)
        bytes32 obligationUid             // The original escrow obligation UID
    ) external view returns (bool);
}
```

This is the **core extensibility point** of the protocol. Built-in arbiters:

| Arbiter | What It Does |
|---------|-------------|
| `TrivialArbiter` | Always returns true — no validation |
| `TrustedPartyArbiter` | Only accepts fulfillment from a specific address |
| `TrustedOracleArbiter` | Accepts fulfillment validated by a trusted oracle |
| `SpecificAttestationArbiter` | Requires a specific attestation UID as proof |
| `AnyArbiter` | OR-composition — any one of N sub-arbiters passes |
| `AllArbiter` | AND-composition — all N sub-arbiters must pass |
| `IntrinsicsArbiter` | Checks attestation intrinsic properties |
| `AttesterArbiter` (Composing/NonComposing) | Checks who made the attestation |
| `RecipientArbiter` (Composing/NonComposing) | Checks attestation recipient |
| `SchemaArbiter` (Composing/NonComposing) | Checks attestation schema |
| `ExpirationTimeArbiter` variants | Time-based checks |
| `TimeAfterArbiter` / `TimeBeforeArbiter` variants | Temporal constraints |
| `RefUidArbiter` variants | Reference chain validation |
| `UidArbiter` variants | Specific UID matching |
| `RevocableArbiter` variants | Revocability checks |
| `ERC20PaymentFulfillmentArbiter` | Checks that a specific ERC20 payment was made |

**Composing vs NonComposing:** Composing arbiters wrap another arbiter (pass-through with extra check). NonComposing are terminal validators.

**Layer 3: Barter Utilities**
Higher-level contracts that compose escrow + payment into atomic swaps:
- `ERC20BarterUtils` / `ERC20BarterCrossToken` — Token-for-token swaps
- `ERC721BarterUtils` / `ERC721BarterCrossToken`
- `ERC1155BarterUtils` / `ERC1155BarterCrossToken`
- `TokenBundleBarterUtils` — Bundle-for-bundle
- `NativeTokenBarterUtils` (planned)
- `AttestationBarterUtils` — Attestation-for-attestation swaps

### 1.3 Escrow Flow (Step by Step)

1. **Buyer creates escrow:** Calls `ERC20EscrowObligation.doObligation()` with:
   - Token address + amount to lock
   - Arbiter address (who decides if demand is met)
   - Demand bytes (ABI-encoded requirements)
   - This creates an EAS attestation and locks tokens in the contract

2. **Seller reads escrow attestation:** Decodes the obligation data to understand what's demanded

3. **Seller fulfills demand:** Creates a fulfillment attestation (e.g., `StringObligation` with a result CID, or `ERC20PaymentObligation` for a token swap)

4. **Seller collects:** Calls `collectEscrow()` on the escrow obligation contract, passing:
   - The escrow attestation UID
   - The fulfillment attestation UID
   - The contract calls the arbiter's `checkObligation()` with the fulfillment attestation
   - If arbiter returns true, tokens are released to the seller

5. **Alternative: Buyer cancels** (if no fulfillment yet, or if time expires)

### 1.4 SDK Surface

**TypeScript SDK** (`alkahest-ts`, archived Feb 2026):
- `makeClient(viemWalletClient)` → returns typed clients for each token standard
- `client.erc20.approve()` — approve token spending
- `client.erc20.buyErc20ForErc20()` — create escrow demanding specific tokens
- `client.erc20.payErc20ForErc20()` — fulfill a buy order
- `client.erc20.buyWithErc20()` — generic escrow with custom arbiter + demand
- `client.erc20.collectEscrow()` — claim payment after fulfillment
- `client.erc20.decodeEscrowObligation()` — parse escrow attestation data
- `getAttestation(uid)` — read any attestation
- `getAttestationFromTxHash(hash)` — extract attestation from tx
- `waitForFulfillment(uid)` — poll for escrow completion

**Also available:** Python SDK (`alkahest-py`, archived) and Rust SDK (`alkahest-rs`).

### 1.5 Deployment Status

**Deployed on:**
- Base Sepolia (primary dev chain)
- Filecoin Calibration testnet

**NOT deployed on Base mainnet yet** (as of SDK archive date Feb 2026).

Uses the same EAS contracts as Base:
- EAS: `0x4200000000000000000000000000000000000021`
- SchemaRegistry: `0x4200000000000000000000000000000000000020`

### 1.6 Honest Assessment

**Strengths:**
- Genuinely elegant architecture — using EAS attestations as the universal primitive for ALL exchange state is smart
- Arbiter composability is real depth — you can stack arbiters (AllArbiter, AnyArbiter) for complex validation logic
- Clean separation: obligation contracts handle asset locking, arbiters handle validation, barter utils handle composition
- The `IArbiter` interface is trivially implementable — writing a new arbiter is ~20 lines of Solidity
- Supports everything from trivial token swaps to complex multi-party escrow with oracle validation

**Weaknesses / Concerns:**
- **SDKs are archived** (Feb 2026) — unclear if actively maintained or being rewritten
- **Only on testnets** — no mainnet deployments found
- **Documentation is thin** — the docs site has structure but many pages are stubs or "coming soon"
- Whitepaper is "coming soon"
- The protocol is young and the ecosystem is small

**Is there real depth?** Yes. This is not a simple 2-of-2 escrow. The arbiter composition system and the attestation-native design give it genuine flexibility. The ability to escrow attestations themselves (not just tokens) is particularly interesting for information exchange.

---

## 2. Ethereum Attestation Service (EAS)

### 2.1 What Is It?

EAS is a public-good infrastructure for making attestations on-chain or off-chain. It provides two core contracts:

1. **SchemaRegistry.sol** — Register attestation schemas (data structure definitions)
2. **EAS.sol** — Create, revoke, and read attestations

An attestation is simply: "Entity X signed structured data Y about subject Z at time T."

### 2.2 Core Concepts

**Schemas:**
A schema is a string like `"uint256 eventId, uint8 voteIndex"` that defines the data structure. Schemas are registered on-chain and get a unique UID. They can optionally have:
- A **resolver contract** (custom logic executed on attestation creation/revocation)
- A **revocable** flag

The `SchemaRecord` struct:
```solidity
struct SchemaRecord {
    bytes32 uid;
    ISchemaResolver resolver;
    bool revocable;
    string schema;
}
```

**Attestations:**
Each attestation contains:
- `uid` — hash of the entire attestation (unique identifier)
- `schema` — which schema it conforms to
- `time` — creation timestamp
- `expirationTime` — when it expires (0 = never)
- `revocationTime` — when revoked (0 = not revoked)
- `refUID` — reference to another attestation (for chaining)
- `recipient` — who the attestation is about
- `attester` — who made it
- `revocable` — whether it can be revoked
- `data` — ABI-encoded payload matching the schema

**Resolver Contracts:**
Optional smart contracts attached to schemas that execute custom logic:
- Gate who can attest/revoke
- Require payments
- Mint NFTs on attestation
- Enforce time constraints
- **This is how Alkahest works** — its obligation contracts are EAS resolvers

### 2.3 On-Chain vs Off-Chain Attestations

**On-chain:**
- Stored in the EAS contract on the blockchain
- Costs gas
- Fully verifiable by anyone
- Immutable (can be revoked but not edited)

**Off-chain:**
- Signed data (EIP-712) stored externally (IPFS, server, p2p)
- Gas-free to create
- Can optionally timestamp the UID on-chain (proves existence at time T without revealing data)
- Privacy-preserving — only parties with the attestation can read it

**Private Data (Merkle Tree):**
- Store merkle root on-chain
- Share individual fields + merkle proofs selectively
- Enables selective disclosure — attest to 10 fields, reveal only 2

### 2.4 SDK

`@ethereum-attestation-service/eas-sdk` (TypeScript):

```typescript
import { EAS, SchemaEncoder, SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';

// Register a schema
const schemaRegistry = new SchemaRegistry(registryAddress);
schemaRegistry.connect(signer);
const tx = await schemaRegistry.register({
    schema: "bytes32 roomId, address[] participants, bytes32 outcomeHash",
    resolverAddress: "0x0000000000000000000000000000000000000000",
    revocable: true,
});

// Create an attestation
const eas = new EAS(easAddress);
eas.connect(signer);
const encoder = new SchemaEncoder("bytes32 roomId, address[] participants, bytes32 outcomeHash");
const encoded = encoder.encodeData([
    { name: "roomId", value: roomId, type: "bytes32" },
    { name: "participants", value: participants, type: "address[]" },
    { name: "outcomeHash", value: hash, type: "bytes32" },
]);
const attestTx = await eas.attest({
    schema: schemaUID,
    data: { recipient, expirationTime: 0, revocable: true, data: encoded },
});
const uid = await attestTx.wait();

// Off-chain attestation (gas-free)
const offchain = await eas.getOffchain();
const offchainAttestation = await offchain.signOffchainAttestation({
    recipient, schema: schemaUID, data: encoded, ...
});

// Private data with merkle trees
const privateData = new PrivateData();
// ... generate merkle proofs for selective disclosure
```

Key methods:
- `eas.attest()` / `eas.multiAttest()` — create attestations
- `eas.revoke()` / `eas.multiRevoke()` — revoke attestations
- `eas.getAttestation(uid)` — read attestation
- `eas.attestByDelegation()` — delegated attestation (third party signs)
- `eas.timestamp()` — on-chain timestamp without full attestation
- `offchain.signOffchainAttestation()` — gas-free off-chain attestation
- `offchain.verifyOffchainAttestationSignature()` — verify off-chain attestation

### 2.5 Deployment

**On Base (our chain):**
- EAS: `0x4200000000000000000000000000000000000021`
- SchemaRegistry: `0x4200000000000000000000000000000000000020`
- EIP712Proxy: `0xF095fE4b23958b08D38e52d5d5674bBF0C03cbF6`
- Indexer: `0x37AC6006646f2e687B7fB379F549Dc7634dF5b84`

**Other chains:** Ethereum, Optimism, Arbitrum One/Nova, Polygon, Scroll, zkSync, Celo, Linea, Blast, Soneium, Ink, Unichain, + many testnets.

EAS is a **Base predeploy** (0x4200... addresses), meaning it's part of the Base protocol itself. Maximum availability.

### 2.6 Stats

- 8.7M+ attestations created
- 450k+ unique attesters
- 2.2M+ recipients
- Public good, open-source, permissionless, tokenless, free

---

## 3. Mnemo Integration Analysis

### 3.1 How Mnemo Maps to Alkahest

| Mnemo Concept | Alkahest Primitive | Notes |
|---------------|-------------------|-------|
| Negotiation scope | EscrowObligation | Agent locks collateral, defines terms via demand bytes |
| Scoped reveal | Fulfillment attestation | Information shared as attestation data (string, bytes) |
| Scope close (commit) | `collectEscrow()` | Arbiter validates fulfillment, releases escrow |
| Scope close (rollback) | Escrow cancellation / revocation | Tokens returned, attestation revoked |
| TEE attestation | Custom Arbiter | TEE proves computation integrity → arbiter validates |
| Consent mechanism | TrustedPartyArbiter | Only consenting parties can trigger fulfillment |
| Nested scopes | `refUID` chaining | Attestations reference parent attestations |

### 3.2 The Key Integration: TEE Attestation Arbiter

The most compelling integration is a **TEEAttestationArbiter** — a new arbiter type that:

1. Receives a fulfillment attestation containing a TEE remote attestation quote
2. Verifies the quote on-chain (or checks against a trusted oracle that verified it)
3. Validates that the attested computation matches the escrow demand
4. Returns true only if TEE attestation is valid

This is genuinely novel because:
- Current arbiters are trust-based (TrustedParty) or trivial
- A TEE arbiter provides **cryptographic** verification of computation integrity
- It bridges the gap between off-chain private computation and on-chain settlement

**Implementation approach:**
```solidity
contract TEEAttestationArbiter is IArbiter {
    function checkObligation(
        Attestation memory fulfillment,
        bytes memory demand,
        bytes32 obligationUid
    ) external view returns (bool) {
        // Decode demand: expected TEE measurement, expected output hash
        (bytes32 expectedMeasurement, bytes32 expectedOutputHash) =
            abi.decode(demand, (bytes32, bytes32));

        // Decode fulfillment data: TEE quote, output hash
        (bytes memory teeQuote, bytes32 outputHash) =
            abi.decode(fulfillment.data, (bytes, bytes32));

        // Verify TEE quote (simplified — real impl would verify DCAP/EPID)
        require(verifyTEEQuote(teeQuote, expectedMeasurement));
        require(outputHash == expectedOutputHash);

        return true;
    }
}
```

### 3.3 How Mnemo Could Use EAS Directly

Even without Alkahest, EAS alone is valuable for Mnemo:

**1. Negotiation Outcome Attestations**
Schema: `bytes32 roomId, address[] participants, bytes32 outcomeHash, bool consensus`
- After a negotiation room closes, attest to the outcome
- Off-chain attestation for privacy, on-chain timestamp for proof of existence
- Selective disclosure via merkle proofs (reveal outcome to some parties, not all)

**2. TEE Verification Attestations**
Schema: `bytes32 enclaveId, bytes32 measurement, uint64 timestamp, bytes32 reportHash`
- TEE attestation results logged as EAS attestations
- Provides an on-chain audit trail of TEE verification events

**3. Agent Reputation**
Schema: `address agent, bytes32 roomId, uint8 behavior, string notes`
- Attest to agent behavior in negotiations
- Build composable reputation from attestation chains

**4. Commitment Logs (replacing our custom approach)**
Schema: `bytes32 scopeId, address owner, bytes32 stateHash, uint8 action`
- EAS attestations as our commitment log layer
- Advantage over custom contracts: standard tooling, explorers, composability
- `refUID` chaining gives us a natural DAG structure

### 3.4 The Full Pipeline

```
Mnemo Negotiation Room (TEE)
    ↓ private computation
Agent A reveals info to Agent B (scoped reveal)
    ↓ outcome determined
TEE produces attestation quote
    ↓ exits TEE
EAS: Off-chain attestation of outcome (private, merkle-tree)
    ↓ if settlement needed
Alkahest: ERC20EscrowObligation with TEEAttestationArbiter
    ↓ arbiter validates TEE quote
Settlement: tokens released based on negotiation outcome
    ↓ for reputation
EAS: On-chain attestation of agent behavior
```

### 3.5 Can EAS Replace Our Commitment Logs?

**Yes, partially.** EAS attestations can serve as commitment logs with advantages:
- Standardized format and tooling
- On-chain explorer (base.easscan.org)
- Composability with other protocols
- `refUID` for linking related commitments
- Revocation for explicit invalidation

**But:** EAS attestations are append-only (can revoke but not delete). Our scope model requires node deletion on scope close (rollback). We would need to represent rollback as revocation, which is semantically close but not identical. A revoked attestation still exists on-chain (just marked as revoked), whereas our spec says rollback means data is gone. For privacy-critical applications, off-chain attestations with on-chain timestamps might be better — the actual data is never on-chain, only the timestamp proof.

---

## 4. Arkhai Bounty Assessment

### 4.1 The Bounty

"Escrow Ecosystem Extensions" — $450 for novel arbiter types, obligation structures.

### 4.2 What We Could Submit

**Option A: TEEAttestationArbiter** (strongest)
- Novel arbiter that validates TEE remote attestation quotes
- Bridges private computation (TEE) with on-chain settlement
- No existing arbiter does this
- Directly useful for Arkhai's vision of autonomous agent commerce

**Option B: ScopedRevealObligation** (more exotic)
- New obligation type for information escrow (not token escrow)
- Agent locks a commitment to reveal information
- Arbiter validates that the reveal matches the commitment
- Settlement releases tokens based on information quality/completeness

**Option C: CompositeNegotiationArbiter** (integration play)
- Arbiter that checks a chain of attestations representing a multi-step negotiation
- Validates that all steps were completed in order, by authorized parties
- Uses `refUID` chaining to traverse the negotiation history

### 4.3 Honest Bounty Viability Assessment

**Pros:**
- $450 is modest but achievable in a day's work
- The TEEAttestationArbiter is genuinely novel and fits Arkhai's thesis
- We're already building on Base with TEE infrastructure
- The arbiter interface is simple — implementation is focused

**Cons:**
- Alkahest SDKs are archived — unclear if the project is actively maintained or being rewritten under the Arkhai brand
- Only on testnets — no production validation
- We'd be building on potentially abandoned infrastructure
- The bounty is small relative to our main hackathon effort

**Risk:** We spend time integrating with a protocol that might not be maintained post-hackathon.

**Recommendation:** The TEEAttestationArbiter is worth building regardless of the bounty because:
1. It demonstrates our TEE integration concretely
2. EAS is a mature, production protocol (even if Alkahest's layer on top is young)
3. The arbiter itself is useful beyond Alkahest — it's a general-purpose TEE verification primitive
4. $450 for a day's work on something we'd want anyway is good ROI

### 4.4 Do Alkahest and EAS Work Together?

They don't just "work together" — **Alkahest IS built on EAS**. Every Alkahest obligation is an EAS attestation. Every arbiter validates EAS attestations. The contract addresses in the Alkahest config include EAS and SchemaRegistry addresses directly. The integration is structural, not superficial.

This means:
- Any EAS attestation can be used as fulfillment proof in Alkahest
- Any Alkahest escrow can be referenced by other EAS attestations
- Off-chain EAS attestations can be timestamped and then used as evidence in Alkahest disputes
- The full EAS SDK works alongside the Alkahest SDK

---

## 5. Contract Addresses Reference

### EAS on Base Mainnet
| Contract | Address |
|----------|---------|
| EAS | `0x4200000000000000000000000000000000000021` |
| SchemaRegistry | `0x4200000000000000000000000000000000000020` |
| EIP712Proxy | `0xF095fE4b23958b08D38e52d5d5674bBF0C03cbF6` |
| Indexer | `0x37AC6006646f2e687B7fB379F549Dc7634dF5b84` |

### Alkahest on Base Sepolia (testnet only)
| Contract | Address |
|----------|---------|
| ERC20EscrowObligation | `0xFa76421cEe6aee41adc7f6a475b9Ef3776d500F0` |
| ERC20PaymentObligation | `0xE95d3931E15E4d96cE1d2Dd336DcEad35A708bdB` |
| TrivialArbiter | `0x7D4bCD84901cEC903105564f63BE70432448B222` |
| TrustedPartyArbiter | `0x3895398C46da88b75eE3ca3092F7714BEbE795a5` |
| TrustedOracleArbiter | `0x361E0950534F4a54A39F8C4f1f642C323f6e66B9` |
| SpecificAttestationArbiter | `0xdE5eCFC92E3da87865CD29C196aA5cebFdC4D9C6` |
| StringObligation | `0x4edEa259C8E014eeEd583D1a863e020190B21Db7` |
| AttestationEscrowObligation | `0x021d28E9eBc935Bf21fe5Ff48cAAbE126Ed706aB` |

---

## 6. Source Links

- [Arkhai (Alkahest creator)](https://www.arkhai.io/)
- [Alkahest Docs](https://alkahest.coophive.network/)
- [alkahest-ts TypeScript SDK (archived)](https://github.com/CoopHive/alkahest-ts)
- [alkahest-py Python SDK (archived)](https://github.com/CoopHive/alkahest-py)
- [EAS Official Site](https://attest.org/)
- [EAS Documentation](https://docs.attest.org/)
- [EAS SDK (npm)](https://www.npmjs.com/package/@ethereum-attestation-service/eas-sdk)
- [EAS SDK GitHub](https://github.com/ethereum-attestation-service/eas-sdk)
- [EAS Contracts GitHub](https://github.com/ethereum-attestation-service/eas-contracts)
- [EAS Explorer on Base](https://base.easscan.org/)
- [CoopHive GitHub Org](https://github.com/CoopHive)

---

## 7. TL;DR

**Alkahest** is an escrow protocol built natively on EAS attestations. Its core extensibility is the `IArbiter` interface — a single `checkObligation()` function that any contract can implement. Writing a new arbiter is trivially simple (~20 lines of Solidity). The protocol supports token escrow (ERC20/721/1155/bundles) and attestation escrow. SDKs exist in TS/Python/Rust but are archived as of Feb 2026. Only deployed on testnets.

**EAS** is a mature, production-grade attestation infrastructure deployed on Base (as a predeploy). It supports on-chain and off-chain attestations with privacy features (merkle trees, selective disclosure). It's the right layer for Mnemo's commitment logs and negotiation outcome records.

**For Mnemo:** The strongest play is building a `TEEAttestationArbiter` — a new Alkahest arbiter that validates TEE remote attestation quotes for on-chain settlement of private negotiations. This is novel, directly useful, and maps cleanly to the Arkhai bounty. Separately, EAS should be our commitment log layer regardless of whether we integrate with Alkahest.

**Bounty verdict:** Worth pursuing. The TEEAttestationArbiter is something we'd want to build anyway, and $450 for a focused day of work on infrastructure we need is good ROI. The main risk is that Alkahest itself may not survive post-hackathon, but the arbiter pattern and EAS integration are valuable regardless.
