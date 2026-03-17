# Running E2E Tests

## Prerequisites

1. **Bun** (runtime): `curl -fsSL https://bun.sh/install | bash`
2. **Foundry** (forge + anvil): `curl -L https://foundry.paradigm.xyz | bash && foundryup`
3. **OpenRouter API key** (for LLM-backed tests): set `OPENROUTER_API_KEY` in `.env`

Install dependencies from the project root:

```bash
bun install
```

## Test Suites

There are two test files in `packages/verifier/src/__tests__/`:

### 1. `hybrid.test.ts` — Forge Pipeline Tests

Runs the verification pipeline against 3 DVDeFi challenges via `forge test`. No LLM or API key needed.

```bash
cd packages/verifier
bun test src/__tests__/hybrid.test.ts
```

**What it verifies:**

| Test | What happens | Expected |
|------|-------------|----------|
| side-entrance: VALID_BUG | Runs exploit test (passes) + patched test (passes) | verdict = `VALID_BUG`, severity = `critical` |
| truster: VALID_BUG | Same flow for Truster challenge | verdict = `VALID_BUG`, severity = `critical` |
| unstoppable: VALID_BUG | Same flow for Unstoppable challenge | verdict = `VALID_BUG`, severity = `high` |
| challenge registry | Lists all registered challenges | 3 challenges: side-entrance, truster, unstoppable |

**How to verify correctness:**
- All 4 tests should pass
- Each forge pipeline test runs `forge build` + `forge test` against `repos/damn-vulnerable-defi/`
- `VALID_BUG` means: exploit succeeds against vulnerable contracts AND fails against patched contracts
- If a test fails, check that `forge` is on PATH and the DVDeFi repo exists at `repos/damn-vulnerable-defi/`

### 2. `e2e.test.ts` — Agent Negotiation Tests

Runs the full bug disclosure flow: forge verification + LLM-powered prover/verifier negotiation.

```bash
# Source the API key
source .env

# Run from verifier package
cd packages/verifier
OPENROUTER_API_KEY=$OPENROUTER_API_KEY bun test src/__tests__/e2e.test.ts
```

Or run all tests together:

```bash
source .env
OPENROUTER_API_KEY=$OPENROUTER_API_KEY bun test
```

**What it verifies:**

| Test | Scenario | Expected Verdict |
|------|----------|-----------------|
| valid bug | Prover describes Side Entrance flash loan attack. Verifier has evidence showing `VALID_BUG`. | `ACCEPTED` |
| invalid bug | Prover claims patched pool is still vulnerable. Verifier has evidence showing patch works. | `REJECTED` |
| smoke test (mock) | Mock LLM, no API key needed. Tests wiring and verdict extraction. | `ACCEPTED` |

**How to verify correctness:**

The test output includes the full negotiation transcript. Look for:

**Valid bug scenario** — the verifier should:
- Acknowledge the prover's technical description matches the evidence
- Reference the verification evidence (exploit test passed, patch blocks it)
- State `ACCEPTED` in its response

Example correct output:
```
[Turn 1] prover:
The vulnerability lies in the lending pool's flash loan mechanism allowing deposit()
to be called during the callback...

[Turn 2] verifier:
Your claim matches the verified vulnerability exactly. The evidence confirms
VALID_BUG with critical severity. VERDICT: ACCEPTED
```

**Invalid bug scenario** — the verifier should:
- Note that verification evidence shows the patch blocks the attack
- Refuse to accept the claim since it contradicts the evidence
- State `REJECTED` in its response

Example correct output:
```
[Turn 1] prover:
The Side Entrance lending pool patch is incomplete and can still be exploited...

[Turn 2] verifier:
REJECTED. Our verification evidence conclusively shows the patched version blocks
deposit() during flash loan callbacks. The exploit attempt was blocked in testing.
```

**Smoke test** — should always pass (no API key needed):
- 4 turns with strict alternation (prover, verifier, prover, verifier)
- Mock verifier responds with `ACCEPTED`

## Running with Docker (recommended)

The Docker setup runs everything inside a simulated TEE (Phala dstack), which is the closest to production. No local dependencies needed beyond Docker.

### Run all tests (forge + LLM negotiation)

```bash
cd infra/dstack
docker compose --env-file ../../.env up --build e2e
```

### Run forge-only tests (no API key needed)

```bash
cd infra/dstack
docker compose --env-file ../../.env run --build e2e bun test src/__tests__/hybrid.test.ts
```

### What's in the Docker environment

| Container | Role |
|-----------|------|
| `dstack-simulator` | Phala TEE simulator — provides attestation API on port 8090 |
| `e2e` | Test runner — bun + foundry + DVDeFi repo, runs `bun test` from `packages/verifier/` |

The E2E container:
- Installs foundry (forge + anvil) at build time
- Clones DVDeFi repo and pre-builds forge artifacts (cached in the image layer)
- Connects to dstack-simulator via `DSTACK_SIMULATOR_ENDPOINT`
- Passes `OPENROUTER_API_KEY` from your `.env` file

First build takes a few minutes (foundry install + forge compilation). Subsequent runs use cached layers.

### Cleanup

```bash
docker compose --env-file ../../.env down
```

## What the Tests Prove

The E2E tests demonstrate Mnemo's core primitive:

1. **Deterministic verification**: The forge pipeline produces a cryptographic-grade verdict by running real exploit code against real contracts. `VALID_BUG` requires both the exploit to succeed against vulnerable contracts AND fail against patched contracts.

2. **Agent-mediated disclosure**: The prover agent presents a technical claim. The verifier agent evaluates it against machine-verified evidence. The verifier cannot be socially engineered — its verdict is anchored to forge test results.

3. **Rejection of false claims**: When the prover claims a patched vulnerability is still exploitable, the verifier correctly identifies the contradiction with its evidence and rejects.

## Troubleshooting

**Tests skip with "skipped"**: `OPENROUTER_API_KEY` is not set. The LLM tests require it.

**Forge tests fail**: Ensure `forge` and `anvil` are on PATH (`which forge`). Run `cd repos/damn-vulnerable-defi && forge build` to verify compilation works.

**LLM verdict is INCONCLUSIVE**: The model didn't include `ACCEPTED` or `REJECTED` in its response. This can happen with weaker models. The tests use `deepseek/deepseek-chat` via OpenRouter which is reliable. If flaky, re-run — LLM responses are non-deterministic.

**Timeout (120s)**: Forge compilation (first run) + 2 LLM round-trips. Subsequent runs are faster due to forge build cache. Increase timeout if on slow hardware.
