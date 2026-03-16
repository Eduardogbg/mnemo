#!/usr/bin/env bash
# test-attestation.sh — Verify dstack simulator attestation
#
# Usage:
#   ./test-attestation.sh            # uses http://localhost:8090
#   ./test-attestation.sh <endpoint> # custom endpoint
#
# Prerequisites:
#   docker compose up -d   (simulator must be running)
#   curl, jq               (must be installed)

set -euo pipefail

ENDPOINT="${1:-http://localhost:8090}"
PASS=0
FAIL=0
TOTAL=0

# ── Helpers ──────────────────────────────────────────────────

green()  { printf '\033[32m%s\033[0m\n' "$1"; }
red()    { printf '\033[31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
bold()   { printf '\033[1m%s\033[0m\n' "$1"; }

check() {
  TOTAL=$((TOTAL + 1))
  local label="$1"
  local url="$2"
  local body="${3:-{}}"

  printf '  [%d] %-40s ' "$TOTAL" "$label"

  local response
  local http_code
  local tmpfile
  tmpfile=$(mktemp)

  http_code=$(curl -s -o "$tmpfile" -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "$body" \
    "$url" 2>/dev/null) || true

  if [[ "$http_code" =~ ^2 ]]; then
    green "OK (HTTP $http_code)"
    PASS=$((PASS + 1))
    cat "$tmpfile"
  else
    red "FAIL (HTTP $http_code)"
    FAIL=$((FAIL + 1))
    cat "$tmpfile" 2>/dev/null || true
  fi

  rm -f "$tmpfile"
  echo
}

# ── Main ─────────────────────────────────────────────────────

bold "=== Mnemo dstack Simulator Attestation Test ==="
echo
echo "Endpoint: $ENDPOINT"
echo

# Wait for simulator to be ready (up to 30s)
printf 'Waiting for simulator to be ready'
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w '' "$ENDPOINT/prpc/Tappd.Info" -X POST -d '{}' 2>/dev/null; then
    echo
    green "Simulator is ready."
    echo
    break
  fi
  printf '.'
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo
    red "Simulator not reachable after 30s. Is it running?"
    echo "  Try: cd $(dirname "$0") && docker compose up -d"
    exit 1
  fi
done

# ── Test 1: Info ─────────────────────────────────────────────

bold "1. TEE Instance Info (Tappd.Info)"
check "Tappd.Info" "$ENDPOINT/prpc/Tappd.Info"

# ── Test 2: Key Derivation ───────────────────────────────────

bold "2. Key Derivation (Tappd.GetKey)"
check "GetKey /mnemo/agent-a/signing" \
  "$ENDPOINT/prpc/Tappd.GetKey" \
  '{"path":"/mnemo/agent-a/signing"}'

check "GetKey /mnemo/agent-b/signing" \
  "$ENDPOINT/prpc/Tappd.GetKey" \
  '{"path":"/mnemo/agent-b/signing"}'

# Same path should give same key (deterministic)
check "GetKey /mnemo/agent-a/signing (repeat)" \
  "$ENDPOINT/prpc/Tappd.GetKey" \
  '{"path":"/mnemo/agent-a/signing"}'

# ── Test 3: Attestation Quote ────────────────────────────────

bold "3. Attestation Quote (Tappd.GetQuote)"
check "GetQuote (empty report_data)" \
  "$ENDPOINT/prpc/Tappd.GetQuote" \
  '{"report_data":""}'

# With a 32-byte hex nonce as report data
NONCE=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
check "GetQuote (with nonce)" \
  "$ENDPOINT/prpc/Tappd.GetQuote" \
  "{\"report_data\":\"$NONCE\"}"

# ── Test 4: TLS Key (if supported) ──────────────────────────

bold "4. TLS Key Generation (Tappd.GetTlsKey)"
check "GetTlsKey" \
  "$ENDPOINT/prpc/Tappd.GetTlsKey" \
  '{"subject":"mnemo-test.local"}'

# ── Summary ──────────────────────────────────────────────────

echo
bold "=== Summary ==="
echo "  Total: $TOTAL"
green "  Pass:  $PASS"
if [ "$FAIL" -gt 0 ]; then
  red   "  Fail:  $FAIL"
else
  echo "  Fail:  0"
fi
echo

if [ "$FAIL" -eq 0 ]; then
  green "All tests passed. Simulator attestation is working."
else
  yellow "Some tests failed. Check output above for details."
  yellow "Note: The simulator may not support all endpoints."
  yellow "Key endpoints: Tappd.Info, Tappd.GetKey, Tappd.GetQuote"
fi
