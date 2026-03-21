/**
 * @mnemo/chain — On-chain integration for Mnemo.
 */

// ERC-8004
export {
  Erc8004,
  Erc8004Error,
  type Erc8004Service,
  type FeedbackParams,
  type FeedbackEntry,
} from "./erc8004/Erc8004.js"
export {
  mockLayer as Erc8004MockLayer,
  liveLayer as Erc8004LiveLayer,
} from "./erc8004/layer.js"
export {
  IDENTITY_REGISTRY_ADDRESS,
  REPUTATION_REGISTRY_ADDRESS,
  identityRegistryAbi,
  reputationRegistryAbi,
  mnemoEscrowAbi,
  mnemoRegistryAbi,
  mnemoReputationAbi,
} from "./erc8004/abi.js"

// Escrow
export {
  Escrow,
  EscrowError,
  mockLayer as EscrowMockLayer,
  liveLayer as EscrowLiveLayer,
  type EscrowService,
  type EscrowData,
  type EscrowStatus,
  type CreateEscrowParams,
} from "./EscrowClient.js"

// Registry
export {
  Registry,
  RegistryError,
  mockLayer as RegistryMockLayer,
  liveLayer as RegistryLiveLayer,
  type RegistryService,
  type ProtocolData,
} from "./RegistryClient.js"

// IPFS
export {
  IpfsError,
  uploadJson,
  uploadBytes,
  uploadAgentManifest,
  uploadProtocolMetadata,
  type IpfsUploadResult,
  type IpfsConfig,
} from "./ipfs.js"

// IPFS Mock
export {
  startMockIpfs,
  IpfsMockError,
} from "./ipfs-mock.js"

// Attestation
export {
  AttestationError,
  getQuote,
  getKey,
  generateAttestationJson,
  hashFile,
  type AttestationDocument,
  type DerivedKey,
} from "./attestation.js"

// Deploy
export {
  deploy,
  DeployError,
  type DeployResult,
} from "./deploy.js"
