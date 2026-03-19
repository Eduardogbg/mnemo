# Phala CVM Durability, Failover, and Key Recovery

> Research date: 2026-03-19
> Context: Evaluating Phala Cloud as persistent TEE runtime for Mnemo escrow and negotiation state.

---

## TL;DR

Phala CVMs are **not ephemeral**. Deterministic key derivation is instance-independent (same compose file + same deployer = same keys). Encrypted volumes survive restarts. The main trap is that Docker image upgrades change the derived key material. For the hackathon this is fine (pin the image). For production, use Onchain KMS.

---

## 1. Deterministic Key Derivation

Phala's dstack SDK provides `getKey(path)` which derives deterministic secp256k1 private keys.

**Derivation inputs:**

```
SealingKey = KDF(RootKey, (deployer_id, app_hash, nonce, "seal", epoch))
```

| Input | What it is | Changes when... |
|-------|-----------|-----------------|
| `RootKey` | Master secret in DeRoT KMS (TEE-protected) | Never (unless KMS is rotated) |
| `deployer_id` | Your identity as deployer | You use a different account |
| `app_hash` | SHA-256 of Docker Compose config (compose hash from RTMR3) | You change the Docker image or compose file |
| `nonce` | Additional entropy | Varies |
| `epoch` | Rotation variable | Key rotation events |
| `path` | User-specified derivation path (e.g., `"mnemo/wallet"`) | You request a different key |

**Critical property:** Keys are tied to `(deployer_id, app_hash)`, NOT to a specific CVM instance. A replacement CVM with the same compose file and deployer derives identical keys.

**The image upgrade trap:** Changing the Docker image changes `app_hash`, which changes ALL derived keys. This means:
- Funds held by the old key become inaccessible from the new CVM
- Mitigation: drain all funds before upgrading, or use Onchain KMS with multiple whitelisted compose hashes

**Source:** [docs.phala.com/dstack/design-documents/key-management-protocol](https://docs.phala.com/dstack/design-documents/key-management-protocol)

---

## 2. Persistent Storage

Docker volumes are encrypted at rest and survive:
- CVM restarts ✓
- CVM upgrades (image changes) ✓
- Relocation to new node ✓ (claimed, mechanism not detailed)

Docker ephemeral filesystem (non-volume) is **lost** on restart.

Volumes are destroyed on `deleteCvm` (irreversible).

**No backup/export mechanism** is documented for volumes. Treat CVM storage as a durable cache, not the sole source of truth.

**Source:** [docs.phala.com/phala-cloud/faqs](https://docs.phala.com/phala-cloud/faqs)

---

## 3. Multi-CVM Redundancy

- Multiple CVMs with the same compose file derive **identical keys** (good for HA)
- **Storage is NOT shared** between CVM instances
- `replicateCvm` is listed in SDK but unreleased (beyond v0.2.4)
- No built-in load balancing or rolling deployments
- Free tier: 1 CVM. Paid: multiple.

**Implication:** You can run hot standbys that share the same wallet key, but each has independent storage. Application-level state sync is your responsibility.

**Source:** [docs.phala.com/phala-cloud/production-checklist](https://docs.phala.com/phala-cloud/production-checklist)

---

## 4. Disaster Recovery

**What works:**
- Deploy a new CVM with the same compose file → same keys → can resume signing
- On-chain state (commitments, events) survives independently
- Volume data is "preserved" on relocation (per docs)

**What's unclear:**
- No RTO/RPO guarantees
- No documented volume replication across Phala infra
- No manual backup/restore for volumes
- What happens if DeRoT KMS goes down

**Mitigation strategy:**
- Anchor all critical state on-chain (commitment hashes, escrow records)
- Treat CVM volume as a cache that can be rebuilt from chain events
- Pin compose hashes, never use floating Docker tags
- For production: use Onchain KMS (smart-contract-governed, not Phala-centralized)

---

## 5. Cloud KMS vs Onchain KMS

| Feature | Cloud KMS | Onchain KMS |
|---------|-----------|-------------|
| Key authority | Phala Cloud infrastructure | Smart contract on Base |
| Single point of failure | Yes (Phala's KMS) | No (on-chain governance) |
| App hash whitelisting | Automatic (from compose) | Manual (via contract) |
| Multi-image support | No (key changes with image) | Yes (whitelist multiple hashes) |
| Hackathon suitability | Good enough | Better for production |

**Source:** [docs.phala.com/phala-cloud/key-management/cloud-vs-onchain-kms](https://docs.phala.com/phala-cloud/key-management/cloud-vs-onchain-kms)

---

## 6. Implications for Mnemo

### Hackathon (acceptable)
- Pin Docker image hash in compose file
- Use Cloud KMS (simpler setup)
- Store escrow state in Docker volume + anchor commitments on-chain
- Single CVM is fine (no HA needed for demo)

### Production (recommended)
- Onchain KMS on Base with DstackApp contract
- Multi-CVM deployment with shared wallet key
- External state sync (e.g., encrypted backup to Arweave/IPFS)
- Drain-before-upgrade protocol for image changes
- Monitor CVM health, auto-failover to standby
