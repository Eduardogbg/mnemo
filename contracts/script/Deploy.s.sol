// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MnemoEscrow} from "../src/MnemoEscrow.sol";
import {MnemoReputation} from "../src/MnemoReputation.sol";
import {MnemoRegistry} from "../src/MnemoRegistry.sol";

/**
 * @notice Deploy MnemoEscrow + MnemoReputation + MnemoRegistry to Base Sepolia.
 *
 *  Usage (one command):
 *    ./scripts/deploy-sepolia.sh
 *
 *  Or manually:
 *    source .env
 *    forge script script/Deploy.s.sol \
 *      --rpc-url "${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}" \
 *      --private-key "$PRIVATE_KEY" \
 *      --broadcast --verify \
 *      --verifier-url "https://api-sepolia.basescan.org/api" \
 *      --etherscan-api-key "$BASESCAN_API_KEY" \
 *      --via-ir -vvvv
 *
 *  Env vars:
 *    PRIVATE_KEY            — deployer private key (required)
 *    REPUTATION_REGISTRY    — ERC-8004 Reputation Registry on Base Sepolia
 *                             (default: 0x8004B663890DF62C3beaA5e898e77D1EFdE8c49a)
 *    BASE_SEPOLIA_RPC_URL   — RPC endpoint (default: https://sepolia.base.org)
 *    BASESCAN_API_KEY       — for contract verification on Basescan (optional)
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        // ERC-8004 Reputation Registry on Base Sepolia
        // (0x8004B663890DF62C3beaA5e898e77D1EFdE8c49a is the canonical Sepolia deployment)
        address reputationRegistry = vm.envOr(
            "REPUTATION_REGISTRY",
            address(0x8004B663890DF62C3beaA5e898e77D1EFdE8c49a)
        );

        address deployer = vm.addr(deployerKey);
        console.log("Deployer:", deployer);
        console.log("Reputation Registry (ERC-8004):", reputationRegistry);
        console.log("---");

        vm.startBroadcast(deployerKey);

        MnemoEscrow escrow = new MnemoEscrow();
        console.log("MnemoEscrow:", address(escrow));

        MnemoReputation reputation = new MnemoReputation(reputationRegistry, address(escrow));
        console.log("MnemoReputation:", address(reputation));

        MnemoRegistry registry = new MnemoRegistry();
        console.log("MnemoRegistry:", address(registry));

        vm.stopBroadcast();

        // Print .env-ready block for easy copy-paste
        console.log("");
        console.log("=== Add to .env ===");
        console.log("ESCROW_ADDRESS=", address(escrow));
        console.log("ERC8004_ADDRESS=", address(reputation));
        console.log("REGISTRY_ADDRESS=", address(registry));
        console.log("===================");
    }
}
