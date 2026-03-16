# ERC/EIP Standards Reference for Mnemo

Research on Ethereum standards relevant to private agent negotiation rooms with conversation forking, TEE execution, and Base settlement.

---

## Core Standards

### ERC-8004 -- Trustless Agents

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2025-08-13 |
| **Authors** | Marco De Rossi, Davide Crapis, Jordan Ellis, Erik Reppel |
| **EIP** | [eips.ethereum.org/EIPS/eip-8004](https://eips.ethereum.org/EIPS/eip-8004) |
| **Contracts** | [github.com/erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) |

**What it does:** Defines three lightweight on-chain registries -- Identity, Reputation, and Validation -- that let agents discover, evaluate, and interact with each other across organizational boundaries without pre-existing trust. Identity is an ERC-721 where the token URI points to a JSON registration file listing endpoints (A2A, MCP), wallet addresses, DIDs, and ENS names. Reputation stores signed feedback signals on-chain. Validation provides generic hooks for independent verifiers (TEE attestations, zkML, stake-secured re-execution).

**Deployed Addresses:**

| Chain | Identity Registry | Reputation Registry |
|-------|-------------------|---------------------|
| Ethereum Mainnet | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Base | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

**Key Interfaces:**

```solidity
// Identity Registry (ERC-721 based)
register(string agentURI, MetadataEntry[] metadata) -> agentId
register(string agentURI) -> agentId
register() -> agentId
setAgentURI(uint256 agentId, string newURI)
setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)
getAgentWallet(uint256 agentId) -> address
getMetadata(uint256 agentId, string key) -> bytes
setMetadata(uint256 agentId, string key, bytes value)

// Reputation Registry
giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
             string tag1, string tag2, string endpoint,
             string feedbackURI, bytes32 feedbackHash)
revokeFeedback(uint256 agentId, uint64 feedbackIndex)
getSummary(uint256 agentId, address[] clientAddresses,
           string tag1, string tag2) -> (count, value, decimals)

// Validation Registry
validationRequest(address validator, uint256 agentId,
                  string requestURI, bytes32 requestHash)
validationResponse(bytes32 requestHash, uint8 response,
                   string responseURI, bytes32 responseHash, string tag)
getValidationStatus(bytes32 requestHash) -> (validator, agentId, response, ...)
```

**Agent Identifier Format:** `eip155:{chainId}:{identityRegistry}:{agentId}`

**Relevance to Mnemo:** This is the central standard. Every agent entering a Mnemo negotiation room registers via the Identity Registry on Base. The Validation Registry can record TEE attestations from Phala proving that the agent's code ran unmodified inside the enclave. After a negotiation completes (or forks and settles), reputation feedback gets posted to the Reputation Registry. Phala already ships an [ERC-8004 TEE agent template](https://github.com/Phala-Network/erc-8004-tee-agent) that combines on-chain identity with Intel TDX attestation.

---

### ERC-8183 -- Agentic Commerce

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-02-25 |
| **Authors** | Davide Crapis, Bryan Lim, Tay Weixiong, Chooi Zuhwa |
| **EIP** | [eips.ethereum.org/EIPS/eip-8183](https://eips.ethereum.org/EIPS/eip-8183) |

**What it does:** Job escrow protocol for agent-to-agent commerce. A Client locks funds, a Provider submits work, and an Evaluator (third party) signals completion or rejection. State machine: Open -> Funded -> Submitted -> Terminal (Completed / Rejected / Expired). Includes a modular hook system (`IACPHook`) for extending lifecycle with custom logic (milestone payments, bidding, underwriting). `claimRefund()` is deliberately unhookable to guarantee recovery after expiry.

**Key Interfaces:**

```solidity
createJob(address provider, address evaluator, uint256 expiredAt,
          string description, address hook) -> uint256 jobId
fund(uint256 jobId, uint256 expectedBudget, bytes optParams)
submit(uint256 jobId, bytes32 deliverable, bytes optParams)
complete(uint256 jobId, bytes32 reason, bytes optParams)
reject(uint256 jobId, bytes32 reason, bytes optParams)
claimRefund(uint256 jobId)
```

**Relevance to Mnemo:** This is the settlement layer. When two agents in a Mnemo room reach a deal, the commitment can be materialized as an ERC-8183 Job on Base. The room's TEE enclave (or a designated third-party agent) serves as the Evaluator. The hook system can enforce Mnemo-specific logic like "release funds only if both parties committed to the same conversation branch." Designed to work alongside ERC-8004 -- completed jobs feed reputation signals back to the Reputation Registry.

---

## Account Abstraction Stack

### ERC-4337 -- Account Abstraction Using Alt Mempool

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2021-09-29 |
| **EIP** | [eips.ethereum.org/EIPS/eip-4337](https://eips.ethereum.org/EIPS/eip-4337) |
| **Docs** | [docs.erc4337.io](https://docs.erc4337.io/) |

**What it does:** Introduces UserOperations that get bundled and submitted to a singleton EntryPoint contract, enabling smart contract wallets without consensus-layer changes. Supports gas sponsorship via Paymasters, custom signature validation, and batched execution. The canonical v0.7 EntryPoint is deployed at the same CREATE2 address across all EVM chains.

**EntryPoint v0.7 on Base:** [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://basescan.org/address/0x0000000071727de22e5e9d8baf0edac6f37da032)

**Relevance to Mnemo:** Agent wallets inside TEE enclaves are smart accounts, not EOAs. ERC-4337 lets the TEE sign UserOperations that get bundled and submitted without the agent needing to hold ETH for gas (a Paymaster can sponsor). This is how agents inside Phala enclaves transact on Base -- the enclave holds the signing key, constructs UserOps, and a bundler submits them.

---

### EIP-7702 -- Set EOA Account Code

| Field | Value |
|-------|-------|
| **Status** | Final (included in Pectra, live on mainnet since May 2025) |
| **Created** | 2024-05-07 |
| **EIP** | [eips.ethereum.org/EIPS/eip-7702](https://eips.ethereum.org/EIPS/eip-7702) |

**What it does:** Introduces transaction type 0x04 that lets an EOA set a "delegation designator" -- a pointer to a smart contract whose code the EOA executes as its own (like delegatecall). This lets EOAs temporarily behave as smart accounts: batch transactions, sponsor gas, delegate permissions. The original private key retains override authority and can revoke/replace the delegation at any time.

**Relevance to Mnemo:** Changes the landscape for agent wallets. If an agent already has an EOA (e.g., from a Lit Protocol PKP), EIP-7702 lets it gain smart account capabilities (batching, delegation, session keys) without deploying a separate contract wallet. For hackathon purposes, this simplifies the architecture -- agents can use 7702-enabled EOAs instead of full ERC-4337 smart accounts if the use case doesn't require Paymaster sponsorship.

---

### ERC-7579 -- Minimal Modular Smart Accounts

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2023-12-14 |
| **EIP** | [eips.ethereum.org/EIPS/eip-7579](https://eips.ethereum.org/EIPS/eip-7579) |
| **Site** | [erc7579.com](https://erc7579.com/) |

**What it does:** Defines the minimum interfaces for modular smart accounts and their modules to ensure cross-implementation interoperability. Four module types: Validators (Type 1, used during ERC-4337 validation), Executors (Type 2, execute on behalf of account via callbacks), Fallback Handlers (Type 3), and Hooks (Type 4, pre/post-transaction logic). Adopted by Safe, Biconomy, ZeroDev, and others.

**Relevance to Mnemo:** If agent wallets are ERC-4337 smart accounts, ERC-7579 modules can enforce negotiation-specific constraints. A custom Validator module could require TEE attestation signatures. A Hook module could enforce "only allow transactions that match a committed conversation branch." An Executor module could let the Mnemo room contract trigger agent wallet actions upon deal completion.

---

## Delegation & Permissions

### ERC-7710 -- Smart Contract Delegation

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-05-20 |
| **Authors** | Ryan McPeck, Dan Finlay, Rob Dawson, Derek Chiang |
| **EIP** | [eips.ethereum.org/EIPS/eip-7710](https://eips.ethereum.org/EIPS/eip-7710) |

**What it does:** Defines the interface for smart contracts to delegate capabilities to other contracts or EOAs. A Delegator creates delegations; a Delegation Manager validates authority and calls `executeDelegatedAction` on the Delegator. Core function: `redeemDelegations(bytes[] _permissionContexts, bytes32[] _modes, bytes[] _executionCallData)`. Leverages ERC-7579 execution modes. Backed by MetaMask's Delegation Toolkit.

**Relevance to Mnemo:** Enables the "controlled reveal" primitive. An agent in a negotiation room can delegate specific capabilities (e.g., "read my encrypted offer") to the counterparty, scoped by conditions (time, branch ID, TEE attestation). If the deal falls through and the conversation forks/rewinds, the delegation expires or gets revoked. This is the on-chain enforcement layer for Mnemo's "SQL transactions for sensitive information."

---

### ERC-7715 -- Grant Permissions from Wallets

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2024-05-24 |
| **Authors** | Luka Isailovic, Derek Rein, Dan Finlay, et al. |
| **EIP** | [eips.ethereum.org/EIPS/eip-7715](https://eips.ethereum.org/EIPS/eip-7715) |

**What it does:** JSON-RPC methods for dApps to request scoped permissions from wallets. Key methods: `wallet_requestExecutionPermissions`, `wallet_revokeExecutionPermission`, `wallet_getSupportedExecutionPermissions`, `wallet_getGrantedExecutionPermissions`. Permissions are typed (native-token-allowance, ERC20 allowance, etc.) and constrained by rules (expiry timestamps, spending caps). Response includes a `delegationManager` address for ERC-7710 redemption.

**Relevance to Mnemo:** The RPC layer that connects Mnemo's room logic to agent wallets. When an agent enters a negotiation room, the room requests `wallet_requestExecutionPermissions` with scoped permissions (e.g., "allow escrow deposits up to X USDC for the next 1 hour"). The agent's wallet grants or denies. This is how session-like permissions work without the agent handing over its private key.

---

## Payment & Authentication

### x402 -- HTTP-Native Payment Protocol

| Field | Value |
|-------|-------|
| **Status** | Open standard (not an EIP; protocol-level spec) |
| **Created** | 2025-05 (Coinbase launch); Foundation established Sept 2025 with Cloudflare |
| **Authors** | Coinbase, Cloudflare |
| **Spec** | [x402.org](https://www.x402.org/) |
| **GitHub** | [github.com/coinbase/x402](https://github.com/coinbase/x402) |
| **Whitepaper** | [x402-whitepaper.pdf](https://www.x402.org/x402-whitepaper.pdf) |

**What it does:** Revives the HTTP 402 "Payment Required" status code as a machine-readable payment protocol. When a server requires payment, it responds with `402` plus a `PAYMENT-REQUIRED` header containing payment instructions (amount, token, chain, recipient). The client constructs and signs a payment payload, attaches it via `PAYMENT-SIGNATURE` header, and retries. A facilitator service verifies and settles the payment on-chain. Supports ERC-20 payments on Base, Polygon, and Solana. Enables micropayments as low as $0.001 with sub-second settlement. Processed 100M+ payments since launch; 156K weekly transactions. Integrated as the crypto rail in Google's Agent Payments Protocol (AP2).

**Bounty references:**
- **Merit Systems / AgentCash** ($1,750) -- "Build with AgentCash" requires consuming x402-compatible APIs via AgentCash MCP server
- **OpenServ** ($5,000) -- lists "x402-native services" as a desired category

**Relevance to Mnemo:** x402 is the natural payment rail for agent-to-agent API calls. If Mnemo rooms expose endpoints (e.g., "query counterparty's public offer summary"), x402 lets the calling agent pay per request without pre-established API keys or subscriptions. More importantly, x402 is complementary to ERC-8183 (escrow for deals) -- x402 handles the micro-payments for ongoing service consumption, while ERC-8183 handles the macro settlement of negotiated deals. For the hackathon, producing x402-compatible APIs from Mnemo room endpoints could hit the Merit Systems and OpenServ bounties simultaneously.

---

### ERC-8128 -- Signed HTTP Requests with Ethereum (Ethereum Web Auth)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Authors** | Slice team |
| **EIP** | [eip.tools/eip/8128](https://eip.tools/eip/8128) |
| **Discussion** | [ethereum-magicians.org](https://ethereum-magicians.org/t/erc-8128-signed-http-requests-with-ethereum/27515) |

**What it does:** Defines how to authenticate HTTP requests using HTTP Message Signatures (RFC 9421) with Ethereum accounts. Instead of a session-based login (like SIWE), the client signs each HTTP request directly with its Ethereum key. The server verifies the signature against the signer's address. Timestamps and TTLs make old requests auto-expire; nonces make each request single-use. Authentication becomes a property of the request itself, not a stateful session.

**Key difference from SIWE:** SIWE is "sign once, get a session." ERC-8128 is "sign every request." This is better for agents because agents don't have browser sessions -- every call is independent.

**Bounty references:**
- **Slice** ($2,200) -- "Ethereum Web Auth / ERC-8128" track: $500 for best use of ERC-8128 as an authentication primitive

**Relevance to Mnemo:** ERC-8128 pairs naturally with ERC-8004. ERC-8004 answers "what is this agent allowed to do?" (identity, reputation, validation). ERC-8128 answers "did this request actually come from that agent's address?" Together they form a complete authentication + authorization stack. For Mnemo, agents entering a negotiation room could authenticate every HTTP request to the TEE endpoint using ERC-8128, eliminating the need for API keys or session tokens. The TEE verifies the Ethereum signature, checks the agent's ERC-8004 identity, and admits or rejects. This is a cleaner auth model than anything session-based for server-side agents.

---

## Supporting Standards

### ERC-721 -- Non-Fungible Token Standard

| Field | Value |
|-------|-------|
| **Status** | Final |

**Relevance:** ERC-8004's Identity Registry is an ERC-721. Each registered agent is an NFT. This means agent identities are transferable, composable with existing NFT tooling, and queryable via standard interfaces.

---

### ERC-1271 -- Standard Signature Validation Method for Contracts

| Field | Value |
|-------|-------|
| **Status** | Final |

**Relevance:** Required by both ERC-7710 and ERC-8004. Allows smart contract wallets (agent accounts) to validate signatures, which is essential when agents sign commitments or attestations inside TEE enclaves and the signature needs to be verified on-chain against a contract account rather than an EOA.

---

### EIP-712 -- Typed Structured Data Hashing and Signing

| Field | Value |
|-------|-------|
| **Status** | Final |

**Relevance:** ERC-8004 requires EIP-712 for `setAgentWallet` signatures. All structured data that agents sign inside TEE enclaves (offers, commitments, branch selections) should use EIP-712 for human-readable signing and replay protection.

---

### Ethereum Attestation Service (EAS)

Not an ERC, but referenced by ERC-8004 as an integration point.

**What it does:** General-purpose on-chain/off-chain attestation protocol. Creates immutable attestation records linking attesters to claims about subjects.

**Relevance to Mnemo:** Can link a client, an agent, a specific negotiation job, and off-chain feedback into a single attestation record. Useful for post-negotiation audit trails.

---

## Standard Relationships Map

```
                    ERC-8004 (Identity/Reputation/Validation)
                    /    |               |
             ERC-8128    |          feeds reputation
          (HTTP Auth) registers          |
                    \    |          ERC-8183 (Escrow/Settlement)
                     Agent Wallet        |        x402
                    /    |    \     hooks enforce  (HTTP micro-
                   /     |     \    room logic      payments)
           ERC-4337  EIP-7702  ERC-7579
           (Smart    (EOA      (Modular
           Account)  upgrade)  Modules)
                  \      |      /
                   \     |     /
                    Delegation Layer
                    /           \
              ERC-7710       ERC-7715
              (On-chain      (Wallet RPC
              delegation)    permissions)
```

---

## Hackathon Implementation Priority

1. **ERC-8004** -- Register agents on Base Identity Registry, post TEE attestations to Validation Registry. This is table stakes for the hackathon (official partner standard).
2. **ERC-8183** -- Use the Job escrow pattern for deal settlement. The Client/Provider/Evaluator model maps cleanly onto Mnemo's negotiation participants.
3. **ERC-4337** -- Agent wallets as smart accounts on Base with Paymaster sponsorship for gas-free agent transactions.
4. **ERC-7710 + ERC-7715** -- Scoped delegation for "controlled reveal" and session-like permissions. Stretch goal but high differentiation.
5. **ERC-7579** -- Custom modules for TEE attestation validation and branch-aware hooks. Stretch goal.
6. **EIP-7702** -- Useful if building with Lit Protocol PKPs (already EOAs). Can skip if going pure ERC-4337.
7. **ERC-8128** -- Per-request HTTP auth for agent-to-TEE communication. Low effort, pairs with ERC-8004, hits Slice bounty ($500).
8. **x402** -- Expose Mnemo room endpoints as x402-payable APIs. Medium effort, hits Merit Systems ($1,750) and OpenServ ($5,000) bounties.

---

## Sources

- [ERC-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [ERC-8004 Contracts (GitHub)](https://github.com/erc-8004/erc-8004-contracts)
- [Phala ERC-8004 TEE Agent](https://github.com/Phala-Network/erc-8004-tee-agent)
- [ERC-8183 Specification](https://eips.ethereum.org/EIPS/eip-8183)
- [ERC-4337 Documentation](https://docs.erc4337.io/)
- [EntryPoint v0.7 on BaseScan](https://basescan.org/address/0x0000000071727de22e5e9d8baf0edac6f37da032)
- [EIP-7702 Specification](https://eips.ethereum.org/EIPS/eip-7702)
- [ERC-7579 Specification](https://eips.ethereum.org/EIPS/eip-7579)
- [ERC-7710 Specification](https://eips.ethereum.org/EIPS/eip-7710)
- [ERC-7715 Specification](https://eips.ethereum.org/EIPS/eip-7715)
- [Composable Security: ERC-8004 Practical Explainer](https://composable-security.com/blog/erc-8004-a-practical-explainer-for-trustless-agents/)
- [Phala: Deploy ERC-8004 Agent in TEE](https://phala.com/posts/erc-8004-launch)
- [MetaMask Delegation Toolkit](https://docs.metamask.io/smart-accounts-kit/concepts/delegation/)
- [Circle: Pectra Upgrade & EIP-7702](https://www.circle.com/blog/how-the-pectra-upgrade-is-unlocking-gasless-usdc-transactions-with-eip-7702)
- [Safe: ERC-7579 Overview](https://docs.safe.global/advanced/erc-7579/overview)
- [x402 Official Site](https://www.x402.org/)
- [x402 GitHub (Coinbase)](https://github.com/coinbase/x402)
- [x402 Whitepaper](https://www.x402.org/x402-whitepaper.pdf)
- [Coinbase x402 Developer Docs](https://docs.cdp.coinbase.com/x402/welcome)
- [ERC-8128 Specification](https://eip.tools/eip/8128)
- [ERC-8128 Discussion (Ethereum Magicians)](https://ethereum-magicians.org/t/erc-8128-signed-http-requests-with-ethereum/27515)
- [ERC-8128 Review (Four Pillars)](https://4pillars.io/en/comments/a-review-of-erc-8128)
