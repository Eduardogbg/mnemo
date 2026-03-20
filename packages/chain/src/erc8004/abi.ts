/**
 * ABI definitions for ERC-8004 Identity and Reputation registries.
 *
 * Canonical Base Sepolia addresses:
 *   Identity:   0x8004A818154A60E50A4271D1be4F2eBcCBBbAD76
 *   Reputation: 0x8004B663890Df62C3beAa5E898e77D1efDE8C49a
 */

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export const IDENTITY_REGISTRY_ADDRESS = "0x8004A818154A60E50A4271D1be4F2eBcCBBbAD76" as const
export const REPUTATION_REGISTRY_ADDRESS = "0x8004B663890Df62C3beAa5E898e77D1efDE8C49a" as const

// ---------------------------------------------------------------------------
// Identity Registry ABI (minimal — only functions we use)
// ---------------------------------------------------------------------------

export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setMetadata",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "key", type: "string" },
      { name: "value", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getMetadata",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "agentURI",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ownerOf",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
    ],
  },
] as const

// ---------------------------------------------------------------------------
// Reputation Registry ABI (minimal — only functions we use)
// ---------------------------------------------------------------------------

export const reputationRegistryAbi = [
  {
    type: "function",
    name: "giveFeedback",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getFeedbackCount",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFeedback",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      { name: "client", type: "address" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
      { name: "timestamp", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "FeedbackGiven",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "value", type: "int128", indexed: false },
    ],
  },
] as const

// ---------------------------------------------------------------------------
// MnemoEscrow ABI (minimal — for EscrowClient)
// ---------------------------------------------------------------------------

export const mnemoEscrowAbi = [
  {
    type: "function",
    name: "create",
    inputs: [
      { name: "funder", type: "address" },
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "commitHash", type: "bytes32" },
    ],
    outputs: [{ name: "escrowId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fund",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "release",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refund",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimExpired",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getEscrow",
    inputs: [{ name: "escrowId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "tee", type: "address" },
          { name: "funder", type: "address" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "commitHash", type: "bytes32" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextEscrowId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "EscrowCreated",
    inputs: [
      { name: "escrowId", type: "uint256", indexed: true },
      { name: "tee", type: "address", indexed: true },
      { name: "commitHash", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EscrowFunded",
    inputs: [
      { name: "escrowId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "EscrowReleased",
    inputs: [
      { name: "escrowId", type: "uint256", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EscrowRefunded",
    inputs: [
      { name: "escrowId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const

// ---------------------------------------------------------------------------
// MnemoReputation ABI (minimal)
// ---------------------------------------------------------------------------

export const mnemoReputationAbi = [
  {
    type: "function",
    name: "postResearcherFeedback",
    inputs: [
      { name: "escrowId", type: "uint256" },
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "severityTag", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "postProtocolFeedback",
    inputs: [
      { name: "escrowId", type: "uint256" },
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "outcomeTag", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const
