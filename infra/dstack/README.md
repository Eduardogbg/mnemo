# Mnemo dstack Local Development Environment

Local TEE development setup using Phala's tappd-simulator. This emulates the dstack guest agent that runs inside a real Confidential VM (CVM) on Phala Cloud.

## Quick Start

```bash
cd infra/dstack

# Start the simulator and placeholder containers
docker compose up -d

# Verify attestation works
chmod +x test-attestation.sh
./test-attestation.sh

# View runtime probe output
docker compose logs mnemo-runtime

# Tear down
docker compose down
```

## What the Simulator Provides

The `phalanetwork/tappd-simulator` container emulates the dstack guest agent API. In production, this agent runs inside a CVM and communicates over `/var/run/dstack.sock`. The simulator exposes the same API over HTTP on port 8090.

### Available API Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /prpc/Tappd.Info` | TEE instance metadata (app_id, instance_id, TCB info) |
| `POST /prpc/Tappd.GetKey` | Deterministic key derivation (secp256k1) |
| `POST /prpc/Tappd.GetQuote` | TDX attestation quote generation |
| `POST /prpc/Tappd.GetTlsKey` | TLS certificate generation with RA-TLS |

### SDK Usage

From application code, use `@phala/dstack-sdk`:

```typescript
import { TappdClient } from '@phala/dstack-sdk';

// Local dev — connects to simulator
const client = new TappdClient('http://localhost:8090');
// Or set DSTACK_SIMULATOR_ENDPOINT=http://localhost:8090

// Production (inside CVM) — auto-connects to /var/run/dstack.sock
// const client = new TappdClient();

const key = await client.getKey('/mnemo/agent-a/signing');
const quote = await client.getQuote(reportData);
```

Install: `npm install @phala/dstack-sdk`

## Simulator vs Real TEE

| Capability | Simulator | Real CVM (Phala Cloud) |
|---|---|---|
| API surface | Identical | Identical |
| Key derivation | Deterministic, but not hardware-bound | Deterministic, hardware-bound via KMS |
| Attestation quotes | Synthetic (mock) | Real TDX quotes, verifiable via Intel PCCS |
| RTMR measurements | Placeholder values | Actual boot chain measurements |
| Encrypted storage | Not encrypted | LUKS-encrypted volumes |
| Network isolation | Docker bridge network | CVM memory encryption boundary |
| Performance | Native Docker speed | ~0-9% overhead depending on workload |

**Key difference:** Simulator attestation quotes will NOT verify against Intel's PCCS. They are structurally correct but cryptographically unsigned by real TEE hardware. Your application logic works identically in both environments.

## Architecture

```
docker compose up
      |
      v
+-- mnemo-internal network (bridge) -----------------------+
|                                                           |
|  dstack-simulator:8090    <-- TEE guest agent emulator    |
|       ^   ^   ^                                           |
|       |   |   |                                           |
|  mnemo-runtime            <-- negotiation harness (stub)  |
|  agent-a                  <-- placeholder agent            |
|  agent-b                  <-- placeholder agent            |
|                                                           |
+-----------------------------------------------------------+
```

All containers share the `mnemo-internal` bridge network. In production, they would share the CVM's internal network with memory-encrypted isolation.

## How Attestation Works in Dev Mode

1. Your app sends a POST to `http://dstack-simulator:8090/prpc/Tappd.GetQuote`
2. The simulator generates a synthetic TDX quote with:
   - Placeholder MRTD, RTMR0-3 values
   - Your `report_data` embedded in the quote
   - A synthetic event log
3. The quote is structurally valid but not cryptographically signed by Intel TDX hardware
4. Your verification logic can parse and inspect the quote fields
5. Skip the Intel PCCS signature check in dev mode (gate on `NODE_ENV` or similar)

### Using curl directly

```bash
# Info
curl -s -X POST http://localhost:8090/prpc/Tappd.Info -d '{}' | jq .

# Key derivation
curl -s -X POST http://localhost:8090/prpc/Tappd.GetKey \
  -H 'Content-Type: application/json' \
  -d '{"path":"/mnemo/agent-a/signing"}' | jq .

# Attestation quote
curl -s -X POST http://localhost:8090/prpc/Tappd.GetQuote \
  -H 'Content-Type: application/json' \
  -d '{"report_data":""}' | jq .
```

## Known Limitations

1. **No real attestation verification** — Quotes are mock. Cannot test end-to-end attestation verification against Intel PCCS.
2. **No LUKS encryption** — Docker volumes are not encrypted. Do not store real secrets in dev mode.
3. **Keys are not hardware-bound** — Derived keys are deterministic but anyone running the simulator gets the same keys for the same paths. In production, keys are bound to the specific app image hash.
4. **No KMS policy enforcement** — The simulator does not enforce on-chain authorization policies.
5. **Socket vs HTTP** — In production, the guest agent listens on `/var/run/dstack.sock` (Unix socket). The simulator uses HTTP on port 8090. The SDK handles this transparently.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Full local dev composition |
| `runtime-probe.mjs` | Connectivity validation script (runs in mnemo-runtime container) |
| `test-attestation.sh` | Host-side test script for verifying simulator endpoints |
| `README.md` | This file |

## Next Steps

- [ ] Replace `mnemo-runtime` stub with actual Mnemo harness
- [ ] Replace `agent-a` / `agent-b` stubs with agent processes
- [ ] Add `@phala/dstack-sdk` to harness dependencies
- [ ] Implement attestation verification endpoint in the runtime
- [ ] Create production `docker-compose.yml` (with `/var/run/dstack.sock` volume mount instead of HTTP simulator)
