// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MnemoEscrow} from "../src/MnemoEscrow.sol";
import {MnemoReputation} from "../src/MnemoReputation.sol";

/**
 * @notice Deploy MnemoEscrow + MnemoReputation to Base Sepolia.
 *
 *  Usage:
 *    forge script script/Deploy.s.sol --rpc-url base-sepolia --broadcast --verify
 *
 *  Env vars:
 *    PRIVATE_KEY — deployer private key
 *    REPUTATION_REGISTRY — ERC-8004 Reputation Registry on Base Sepolia
 *                          (default: 0x8004B663056A597Dffe9eCcC1965A193B7388713)
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        // ERC-8004 Reputation Registry on Base (Sepolia)
        address reputationRegistry = vm.envOr(
            "REPUTATION_REGISTRY",
            address(0x8004B663056A597Dffe9eCcC1965A193B7388713)
        );

        vm.startBroadcast(deployerKey);

        MnemoEscrow escrow = new MnemoEscrow();
        console.log("MnemoEscrow:", address(escrow));

        MnemoReputation reputation = new MnemoReputation(reputationRegistry, address(escrow));
        console.log("MnemoReputation:", address(reputation));

        vm.stopBroadcast();
    }
}
