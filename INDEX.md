# Mnemo — Project Index

| Path | What |
|---|---|
| [README.md](README.md) | **Project README** — problem statement, solution, architecture, setup, what we shipped |
| [DEMO.md](DEMO.md) | **Demo guide** — prerequisites, 3-terminal walkthrough, Docker Compose setup |
| [CLAUDE.md](CLAUDE.md) | Agent instructions, API key locations, inference priority, package notes |
| [agent.json](agent.json) | ERC-8004 agent manifest — service declarations, trust model, registry addresses |

## Specification

| Path | What |
|---|---|
| [spec/protocol.md](spec/protocol.md) | **Protocol spec v3** — scope model, consent rules, context reconstruction, 15 invariants |
| [spec/protocol-v4.md](spec/protocol-v4.md) | **Protocol spec v4** — Vegas Room (black box TEE model) |
| [spec/quint/](spec/quint/) | Quint formal spec (7 files) — types, negotiation, session, attestation, context, properties, scenarios |
| [spec/critique-gpt5.2.md](spec/critique-gpt5.2.md) | GPT-5.2 critique of v2 spec (led to v3 fixes) |
| [spec/critique-codex.md](spec/critique-codex.md) | Codex critique of scope model |

## Design

| Path | What |
|---|---|
| [docs/design/harness-design.md](docs/design/harness-design.md) | **Harness architecture** — standalone TS, @effect/ai, 4 containers, hub-and-spoke |
| [docs/design/design-bug-disclosure.md](docs/design/design-bug-disclosure.md) | Bug disclosure agent design — researcher/protocol negotiation via scoped reveals |
| [docs/design/bug-disclosure-demo.md](docs/design/bug-disclosure-demo.md) | **Bug disclosure demo** — test corpus (DVDeFi), invariant catalog, TEE verifier tools, implementation plan |
| [docs/design/bug-disclosure-product.md](docs/design/bug-disclosure-product.md) | Bug disclosure product concept — problem statement, market positioning |
| [docs/design/ethical-hacker-agent.md](docs/design/ethical-hacker-agent.md) | Ethical hacker agent — autonomous researcher evolution, 5-phase loop design |
| [docs/design/agent-protocol-network.md](docs/design/agent-protocol-network.md) | **Agent-protocol network** — MnemoRegistry, TEE gateway as matchmaker, 29-step message flow, event-based discovery |
| [docs/design/tee-submission-architecture.md](docs/design/tee-submission-architecture.md) | **TEE submission architecture** — attestation model, code submission formats, Docker Compose 3-network topology |
| [docs/design/dvdefi-extraction.md](docs/design/dvdefi-extraction.md) | DVDeFi v4 extraction plan — 4 challenges analyzed for verifier demo |
| [docs/design/invariant-catalog.md](docs/design/invariant-catalog.md) | Invariant catalog — programmatic invariants for DVDeFi vulnerability detection |
| [docs/design/verifier-harness.md](docs/design/verifier-harness.md) | Verifier harness — technical design for EVM verification pipeline (Voltaire vs Foundry) |
| [docs/design/voltaire-integration.md](docs/design/voltaire-integration.md) | voltaire-effect integration — source analysis for Mnemo verifier harness |
| [docs/design/voltaire-deploy-foundry.md](docs/design/voltaire-deploy-foundry.md) | voltaire-effect deployment & Foundry integration notes |
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
| [docs/research/research-autonomous-agents.md](docs/research/research-autonomous-agents.md) | Autonomous agent research — defining "autonomous agent" for Mnemo, ERC-8004 and bounty targeting |
| [docs/venice-tee-feedback.md](docs/venice-tee-feedback.md) | Venice E2EE/TEE alpha integration feedback to Venice team |

## Research — Inference & Caching

| Path | What |
|---|---|
| [docs/research/research-redpill-kv-caching.md](docs/research/research-redpill-kv-caching.md) | Prefix caching on Redpill — unknown if enabled, TTFT test script |
| [docs/research/research-self-hosted-inference.md](docs/research/research-self-hosted-inference.md) | SGLang vs vLLM — SGLang wins for DAG rewind pattern (RadixAttention) |
| [docs/research/dag-kv-cache-economics.md](docs/research/dag-kv-cache-economics.md) | **KV cache economics** — VRAM numbers, DAG advantage, MoE, interleaving, Phala break-even |
| [docs/research/venice-model-benchmark.md](docs/research/venice-model-benchmark.md) | Venice model benchmark — blind audit of SideEntranceLenderPool across Venice models |

## Research — Harness & Frameworks

| Path | What |
|---|---|
| [docs/research/research-effect-ai.md](docs/research/research-effect-ai.md) | @effect/ai assessment — chosen for harness (DI, typed errors, provider-agnostic) |
| [docs/research/research-pi-extension.md](docs/research/research-pi-extension.md) | Pi extension feasibility — **rejected** (append-only JSONL, no node deletion) |
| [docs/research/harness-landscape.md](docs/research/harness-landscape.md) | Agentic framework patterns — forking, checkpoints, rollback |
| [docs/research/evm_vulnerability_benchmark.md](docs/research/evm_vulnerability_benchmark.md) | EVM vulnerability benchmarks — evmbench (Paradigm/OpenAI), tier analysis for agent testing |

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
| [packages/core/](packages/core/) | **@mnemo/core** — Agent, Provider, State, Errors, shared tool types |
| [packages/chain/](packages/chain/) | **@mnemo/chain** — ERC-8004, EscrowClient, RegistryClient, attestation, IPFS (mock + real), deploy helper |
| [packages/dvdefi/](packages/dvdefi/) | **@mnemo/dvdefi** — Foundry/Anvil services, challenge definitions, forge-based verification pipeline |
| [packages/verity/](packages/verity/) | **@mnemo/verity** — typed invariant checking via voltaire-effect, concrete invariants, PoC scripts |
| [packages/verifier/](packages/verifier/) | **@mnemo/verifier** — hybrid pipeline (forge + invariants), LLM verifier agent + tools, E2E tests |
| [packages/researcher/](packages/researcher/) | **@mnemo/researcher** — autonomous 5-phase loop, execution log, vuln discovery experiments, E2E demo |
| [packages/harness/](packages/harness/) | **@mnemo/harness** — room-based negotiation, provider abstraction (OpenRouter, mock) |
| [packages/venice/](packages/venice/) | **@mnemo/venice** — Venice E2EE client for @effect/ai (ECDH key exchange, AES-256-GCM encryption) |
| [packages/web/](packages/web/) | **@mnemo/web** — React 19 frontend + Effect HttpApi server, real-time WebSocket, PipelineTracker, AuditPanel |

## Contracts

| Path | What |
|---|---|
| [contracts/src/MnemoEscrow.sol](contracts/src/MnemoEscrow.sol) | **TEE-resolved escrow** — create/fund/release/refund lifecycle, blind commitment hashes, permissionless expiry |
| [contracts/src/MnemoReputation.sol](contracts/src/MnemoReputation.sol) | **ERC-8004 reputation wrapper** — asymmetric detail (researcher gets severity, protocol gets outcome only), double-post prevention |
| [contracts/src/MnemoRegistry.sol](contracts/src/MnemoRegistry.sol) | **Protocol discovery registry** — register/update/deactivate |
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
| [infra/dstack/](infra/dstack/) | **Local dstack dev environment** — Docker Compose with tappd-simulator, attestation tools |
| [infra/dstack/docker-compose.yml](infra/dstack/docker-compose.yml) | Dev compose — simulator + runtime + harness + E2E containers |
| [infra/dstack/docker-compose.prod.yml](infra/dstack/docker-compose.prod.yml) | Production CVM compose — runs inside real Phala CVM (no simulator, pre-built images) |
| [infra/dstack/Dockerfile.e2e](infra/dstack/Dockerfile.e2e) | E2E test runner (bun + foundry + DVDeFi, runs alongside TEE simulator) |
| [infra/dstack/Dockerfile.harness](infra/dstack/Dockerfile.harness) | Harness container — dual-agent negotiation inside simulated TEE |
| [infra/dstack/test-attestation.sh](infra/dstack/test-attestation.sh) | Attestation verification script (shell) |
| [infra/dstack/validate-attestation.ts](infra/dstack/validate-attestation.ts) | TDX attestation quote parser + validator |
| [infra/dstack/verify-sandbox.ts](infra/dstack/verify-sandbox.ts) | TEE sandbox attestation verification |
| [infra/dstack/runtime-probe.mjs](infra/dstack/runtime-probe.mjs) | Runtime environment probe |
| [infra/dstack/rpc-proxy/](infra/dstack/rpc-proxy/) | Read-only JSON-RPC allowlist proxy for TEE sandbox (Dockerfile + server.ts) |
| [docs/running-e2e-tests.md](docs/running-e2e-tests.md) | **How to run E2E tests** — local and Docker, verification guidance |

## Scripts

| Path | What |
|---|---|
| [scripts/generate-voiceover.ts](scripts/generate-voiceover.ts) | **Voiceover generator** — ElevenLabs TTS + ffmpeg, 8 timed segments, auto-combines with demo video |
| [scripts/record-demo.ts](scripts/record-demo.ts) | **Demo recorder** — Playwright recording with DOM-injected subtitle overlay |
| [scripts/demo-attestation.ts](scripts/demo-attestation.ts) | TEE attestation demo (valid + tampered + replay) |
| [scripts/deploy-sepolia.sh](scripts/deploy-sepolia.sh) | Shell deployment — loads .env, deploys + verifies on Basescan |
| [scripts/deploy-sepolia.ts](scripts/deploy-sepolia.ts) | Effect deployment wrapper |

## Recordings

| Path | What |
|---|---|
| [recordings/demo.mp4](recordings/demo.mp4) | Raw demo video (~28s) |
| [recordings/demo.srt](recordings/demo.srt) | Subtitle file for demo |
| [recordings/voiceover.mp3](recordings/voiceover.mp3) | Generated voiceover audio (ElevenLabs TTS) |
| [recordings/voiceover-segments/](recordings/voiceover-segments/) | Individual voiceover segment audio files (8 segments) |
| [recordings/demo-narrated.mp4](recordings/demo-narrated.mp4) | Demo video with voiceover combined |

## Meta

| Path | What |
|---|---|
| [docs/conversation-log.md](docs/conversation-log.md) | Verbatim research/ideation log |
| [docs/research-venice-e2ee-effect.md](docs/research-venice-e2ee-effect.md) | Venice E2EE + @effect/ai integration research (duplicate of docs/research/ version) |
| [.env](.env) | API keys & IDs (gitignored) |

## Key Decisions

- **Inference**: Venice (primary, has credits), OpenRouter (backup, may hit weekly limits), Redpill (production GPU-TEE). Self-hosting not worth it at our scale.
- **Harness**: Standalone TypeScript with @effect/ai. Pi extension rejected (can't delete nodes).
- **Privacy**: Venice E2EE protocol reverse-engineered (15 models, Intel TDX + NVIDIA CC). Client nonce bug fixed. Redpill for production GPU-TEE.
- **Settlement**: Stealth addresses (ERC-5564) for funding privacy, TEE-internal escrow logic, MnemoPool on-chain for settlement. See `research-onchain-privacy.md`.
- **TEE durability**: Phala CVM keys are instance-independent (same compose = same key). Image upgrade = key rotation (drain first). See `research-phala-durability.md`.
- **Caching**: Prefix caching optimization is marginal for multi-tenant ($0.02/negotiation savings). Better thesis for Apple Silicon + local agents.
- **Model**: Quint formal spec v3 complete — 15 invariants verified across 10k traces. v4 (Vegas Room) defines black box TEE model.
