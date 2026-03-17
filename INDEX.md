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

## Infrastructure

| Path | What |
|---|---|
| [infra/dstack/](infra/dstack/) | **Local dstack dev environment** — Docker Compose with tappd-simulator, attestation test script |
| [infra/dstack/docker-compose.yml](infra/dstack/docker-compose.yml) | Simulator + runtime + agent containers |
| [infra/dstack/test-attestation.sh](infra/dstack/test-attestation.sh) | Attestation verification script |

## Meta

| Path | What |
|---|---|
| [docs/conversation-log.md](docs/conversation-log.md) | Verbatim research/ideation log |
| [.env](.env) | API keys & IDs (gitignored) |

## Key Decisions

- **Inference**: Redpill API for production (GPU-TEE), OpenRouter for dev. Self-hosting not worth it at our scale.
- **Harness**: Standalone TypeScript with @effect/ai. Pi extension rejected (can't delete nodes).
- **Privacy**: Venice E2EE protocol reverse-engineered (15 models, Intel TDX + NVIDIA CC). Redpill for production GPU-TEE.
- **Caching**: Prefix caching optimization is marginal for multi-tenant ($0.02/negotiation savings). Better thesis for Apple Silicon + local agents.
- **Model**: Quint formal spec v3 complete — 15 invariants verified across 10k traces.
