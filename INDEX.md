# Mnemo — Project Index

## Specification

| Path | What |
|---|---|
| [spec/protocol.md](spec/protocol.md) | **Protocol spec v3** — scope model, consent rules, context reconstruction, 15 invariants |
| [spec/quint/](spec/quint/) | Quint formal spec (7 files) — types, negotiation, session, attestation, context, properties, scenarios |
| [spec/critique-gpt5.2.md](spec/critique-gpt5.2.md) | GPT-5.2 critique of v2 spec (led to v3 fixes) |
| [spec/critique-codex.md](spec/critique-codex.md) | Codex critique of scope model |

## Design

| Path | What |
|---|---|
| [docs/design/harness-design.md](docs/design/harness-design.md) | **Harness architecture** — standalone TS, @effect/ai, 4 containers, hub-and-spoke |
| [docs/design/design-bug-disclosure.md](docs/design/design-bug-disclosure.md) | Bug disclosure agent design — researcher/protocol negotiation via scoped reveals |
| [docs/design/bug-disclosure-demo.md](docs/design/bug-disclosure-demo.md) | **Bug disclosure demo** — test corpus (DVDeFi), invariant catalog, TEE verifier tools, implementation plan |
| [docs/idea.md](docs/idea.md) | Project concept, problem statement, demo scope |
| [AGENT.md](AGENT.md) | Agent behavior instructions |

## Ideas & Scenarios

| Path | What |
|---|---|
| [docs/ideas/ideas-autonomous-scenarios.md](docs/ideas/ideas-autonomous-scenarios.md) | Autonomous RFQ/commerce use cases — compute procurement, insurance, salary, OTC trades |
| [docs/ideas/ideas-games.md](docs/ideas/ideas-games.md) | Game scenarios for the primitive — Liar's Cartography, Vault Cracker, Preference Poker, etc. |
| [docs/ideas/prompt-kv-cache-economics.md](docs/ideas/prompt-kv-cache-economics.md) | Self-contained prompt for KV cache economics analysis |

## Research — TEE & Infrastructure

| Path | What |
|---|---|
| [docs/research/research-phala-dstack.md](docs/research/research-phala-dstack.md) | dstack TEE runtime — local dev, GPU-TEE, SDK, pricing, Mnemo assessment |
| [docs/research/research-phala-dstack-infra.md](docs/research/research-phala-dstack-infra.md) | dstack deep dive — architecture, components, interaction flow |
| [docs/research/research-gpu-tee-inference.md](docs/research/research-gpu-tee-inference.md) | GPU-TEE inference options — discovered Redpill as managed service |
| [docs/research/research-redpill-architecture.md](docs/research/research-redpill-architecture.md) | Redpill deep dive — stateless API, attestation chain, base URL |
| [docs/research/venice-assessment.md](docs/research/venice-assessment.md) | Venice privacy assessment — E2EE available (15 models, Intel TDX + NVIDIA CC); standard inference not TEE-protected |
| [docs/research/research-venice-e2ee-effect.md](docs/research/research-venice-e2ee-effect.md) | **Venice E2EE protocol** — reverse-engineered: ECDH + HKDF("ecdsa_encryption") + AES-256-GCM, 15 models, known bugs |
| [docs/research/research-alkahest-eas.md](docs/research/research-alkahest-eas.md) | Alkahest escrow protocol & EAS — Arkhai bounty evaluation |

## Research — Inference & Caching

| Path | What |
|---|---|
| [docs/research/research-redpill-kv-caching.md](docs/research/research-redpill-kv-caching.md) | Prefix caching on Redpill — unknown if enabled, TTFT test script |
| [docs/research/research-self-hosted-inference.md](docs/research/research-self-hosted-inference.md) | SGLang vs vLLM — SGLang wins for DAG rewind pattern (RadixAttention) |
| [docs/research/dag-kv-cache-economics.md](docs/research/dag-kv-cache-economics.md) | **KV cache economics** — VRAM numbers, DAG advantage, MoE, interleaving, Phala break-even |

## Research — Harness & Frameworks

| Path | What |
|---|---|
| [docs/research/research-effect-ai.md](docs/research/research-effect-ai.md) | @effect/ai assessment — chosen for harness (DI, typed errors, provider-agnostic) |
| [docs/research/research-pi-extension.md](docs/research/research-pi-extension.md) | Pi extension feasibility — **rejected** (append-only JSONL, no node deletion) |
| [docs/research/harness-landscape.md](docs/research/harness-landscape.md) | Agentic framework patterns — forking, checkpoints, rollback |

## Research — Blockchain & Standards

| Path | What |
|---|---|
| [docs/research/research-landscape.md](docs/research/research-landscape.md) | Product landscape — smart accounts, agent wallets, standards |
| [docs/research/ercs.md](docs/research/ercs.md) | ERC-8004, ERC-8183, EIP-7702, supporting standards |
| [docs/research/erc-critique.md](docs/research/erc-critique.md) | Which ERCs to integrate vs name-drop vs skip |
| [docs/research/research-onchain-privacy.md](docs/research/research-onchain-privacy.md) | **On-chain privacy** — stealth addresses (ERC-5564), TEE pool, ZK comparison for settlement |
| [docs/research/research-phala-durability.md](docs/research/research-phala-durability.md) | **Phala CVM durability** — key derivation, failover, storage, disaster recovery |

## Hackathon

| Path | What |
|---|---|
| [docs/synthesis/synthesis-hack.md](docs/synthesis/synthesis-hack.md) | Hackathon API docs, registration spec |
| [docs/synthesis/build-at-synthesis.md](docs/synthesis/build-at-synthesis.md) | Themes and build guidance |
| [docs/synthesis/bounties.md](docs/synthesis/bounties.md) | **All bounties** — 35 tracks, ~$100k total, scraped from Devfolio API |
| [docs/synthesis/bounty-fit-core.md](docs/synthesis/bounty-fit-core.md) | Core bounty fit analysis — ranked by natural fit with Mnemo |
| [docs/synthesis/bounty-fit-side.md](docs/synthesis/bounty-fit-side.md) | Side bounty opportunities — ranked by effort-to-reward ratio |
| [docs/synthesis/bounty-fit-deep.md](docs/synthesis/bounty-fit-deep.md) | Deep sponsor relevance analysis — every sponsor through Mnemo's lens |
| [docs/synthesis/sponsors.md](docs/synthesis/sponsors.md) | Partners and bounty strategy |

## Packages

| Path | What |
|---|---|
| [packages/dvdefi/](packages/dvdefi/) | **DVDeFi integration** — Foundry/Anvil services, 3 challenge definitions, forge-based verification pipeline |
| [packages/verity/](packages/verity/) | **Verity** — typed invariant checking via voltaire-effect, 9 concrete invariants, PoC scripts |
| [packages/verifier/](packages/verifier/) | **Verifier** — hybrid pipeline (forge + invariants), LLM verifier agent + tools, E2E tests |
| [packages/researcher/](packages/researcher/) | **Researcher agent** — autonomous 5-phase loop, execution log, unified E2E demo (`e2e-discovery.ts`) |
| [packages/harness/](packages/harness/) | Agent harness — room-based negotiation, provider abstraction (OpenRouter, mock) |
| [packages/venice/](packages/venice/) | Venice E2EE client — ECDH key exchange, AES-256-GCM encryption |
| [packages/web/](packages/web/) | Demo frontend & API server — Effect HttpApi, Bun, React 19, real-time WebSocket, 10-step PipelineTracker, AuditPanel, two-column layout |

## Contracts

| Path | What |
|---|---|
| [contracts/src/MnemoEscrow.sol](contracts/src/MnemoEscrow.sol) | **TEE-resolved escrow** — create/fund/release/refund lifecycle, blind commitment hashes, permissionless expiry |
| [contracts/src/MnemoReputation.sol](contracts/src/MnemoReputation.sol) | **ERC-8004 reputation wrapper** — asymmetric detail (researcher gets severity, protocol gets outcome only), double-post prevention |
| [contracts/src/MnemoRegistry.sol](contracts/src/MnemoRegistry.sol) | **Protocol discovery registry** — register/update/deactivate, 14 tests |
| [contracts/script/Deploy.s.sol](contracts/script/Deploy.s.sol) | Deployment script for Base Sepolia (Escrow + Reputation + Registry) |
| [contracts/foundry.toml](contracts/foundry.toml) | Foundry config — Base Sepolia RPC, Basescan verification, via_ir |
| [contracts/test/](contracts/test/) | 40 tests (18 escrow + 8 reputation + 14 registry), all passing |
| [scripts/deploy-sepolia.sh](scripts/deploy-sepolia.sh) | **Shell deployment** — loads .env, checks balance, deploys + verifies on Basescan |
| [scripts/deploy-sepolia.ts](scripts/deploy-sepolia.ts) | **Effect deployment** — wrapper for TypeScript deploy via voltaire-effect |
| [packages/chain/scripts/deploy-sepolia.ts](packages/chain/scripts/deploy-sepolia.ts) | **Effect deployment (impl)** — Effect + voltaire-effect, structured errors, on-chain verification, .env.deployed output |
| [.env.example](.env.example) | Environment template — API keys, deployment config, contract addresses |

## Infrastructure

| Path | What |
|---|---|
| [infra/dstack/](infra/dstack/) | **Local dstack dev environment** — Docker Compose with tappd-simulator, attestation test script |
| [infra/dstack/docker-compose.yml](infra/dstack/docker-compose.yml) | Simulator + runtime + harness + E2E containers |
| [infra/dstack/Dockerfile.e2e](infra/dstack/Dockerfile.e2e) | E2E test runner (bun + foundry + DVDeFi, runs alongside TEE simulator) |
| [infra/dstack/test-attestation.sh](infra/dstack/test-attestation.sh) | Attestation verification script |
| [docs/running-e2e-tests.md](docs/running-e2e-tests.md) | **How to run E2E tests** — local and Docker, verification guidance |

## Meta

| Path | What |
|---|---|
| [docs/conversation-log.md](docs/conversation-log.md) | Verbatim research/ideation log |
| [.env](.env) | API keys & IDs (gitignored) |

## Key Decisions

- **Inference**: Redpill API for production (GPU-TEE), OpenRouter for dev. Self-hosting not worth it at our scale.
- **Harness**: Standalone TypeScript with @effect/ai. Pi extension rejected (can't delete nodes).
- **Privacy**: Venice E2EE protocol reverse-engineered (11 models as of March 19, Intel TDX + NVIDIA CC). Client nonce bug fixed. Docs improved to ~60% but critical crypto params still undocumented. Redpill for production GPU-TEE.
- **Settlement**: Stealth addresses (ERC-5564) for funding privacy, TEE-internal escrow logic, MnemoPool on-chain for settlement. See `research-onchain-privacy.md`.
- **TEE durability**: Phala CVM keys are instance-independent (same compose = same key). Image upgrade = key rotation (drain first). See `research-phala-durability.md`.
- **Caching**: Prefix caching optimization is marginal for multi-tenant ($0.02/negotiation savings). Better thesis for Apple Silicon + local agents.
- **Model**: Quint formal spec v3 complete — 15 invariants verified across 10k traces.
