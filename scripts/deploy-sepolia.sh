#!/bin/bash
# Deploy Mnemo contracts to Base Sepolia.
#
# Requirements:
#   - PRIVATE_KEY in .env (funded with Base Sepolia ETH)
#   - Foundry installed (forge)
#
# Optional:
#   - BASE_SEPOLIA_RPC_URL (default: https://sepolia.base.org)
#   - BASESCAN_API_KEY (for contract verification on Basescan)
#
# Get Base Sepolia ETH: https://www.alchemy.com/faucets/base-sepolia
#                       https://faucet.quicknode.com/base/sepolia

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Load .env from project root
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
else
  echo "ERROR: No .env file found at $ROOT_DIR/.env"
  echo "Copy .env.example to .env and fill in PRIVATE_KEY"
  exit 1
fi

# Validate required env vars
if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "ERROR: PRIVATE_KEY not set in .env"
  echo "Generate one with: cast wallet new"
  echo "Then fund it with Base Sepolia ETH from a faucet."
  exit 1
fi

RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

echo "============================================"
echo "  Mnemo — Base Sepolia Deployment"
echo "============================================"
echo ""
echo "  RPC:        $RPC_URL"
echo "  Verify:     ${BASESCAN_API_KEY:+yes}${BASESCAN_API_KEY:-no (set BASESCAN_API_KEY to verify)}"
echo ""

# Check deployer balance
DEPLOYER=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "unknown")
echo "  Deployer:   $DEPLOYER"

BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
echo "  Balance:    $BALANCE wei"
echo ""

if [ "$BALANCE" = "0" ]; then
  echo "ERROR: Deployer has zero balance on Base Sepolia."
  echo "Fund the wallet at: https://www.alchemy.com/faucets/base-sepolia"
  echo "Address: $DEPLOYER"
  exit 1
fi

# Build verification flags
VERIFY_FLAGS=""
if [ -n "${BASESCAN_API_KEY:-}" ]; then
  VERIFY_FLAGS="--verify --verifier-url https://api-sepolia.basescan.org/api --etherscan-api-key $BASESCAN_API_KEY"
fi

echo "Deploying contracts..."
echo ""

cd "$ROOT_DIR/contracts"

# shellcheck disable=SC2086
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  $VERIFY_FLAGS \
  --via-ir \
  -vvvv

echo ""
echo "============================================"
echo "  Deployment complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Copy the deployed addresses from the output above into .env:"
echo "     ESCROW_ADDRESS=<MnemoEscrow address>"
echo "     ERC8004_ADDRESS=<MnemoReputation address>"
echo "     REGISTRY_ADDRESS=<MnemoRegistry address>"
echo ""
echo "  2. Update RPC_URL in .env for the web demo:"
echo "     RPC_URL=$RPC_URL"
echo ""
echo "  3. Start the web demo with live contracts:"
echo "     cd packages/web && bun run src/server.ts"
echo ""
echo "  4. View on Basescan: https://sepolia.basescan.org/address/$DEPLOYER"
