// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MnemoEscrow} from "./MnemoEscrow.sol";

/**
 * @title MnemoReputation
 * @notice Privacy-preserving reputation wrapper around ERC-8004 Reputation Registry.
 *
 *  Design principles:
 *    - Only the TEE can post reputation (sole authorized poster)
 *    - Asymmetric detail: researcher gets severity tags, protocol gets only outcome
 *    - Temporal separation: researcher and protocol feedback posted separately
 *      (in production, at random delays via TEE to break correlation)
 *    - On-chain observers see feedback to agent IDs but cannot link researcher↔protocol
 *
 *  This contract wraps the ERC-8004 ReputationRegistry.giveFeedback() calls
 *  and enforces that only the TEE (escrow resolver) can post.
 */

/// @dev Minimal interface for ERC-8004 Reputation Registry
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

contract MnemoReputation {
    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    IReputationRegistry public immutable registry;
    MnemoEscrow public immutable escrow;

    // Track which escrows have had feedback posted (prevent double-posting)
    mapping(uint256 => bool) public researcherFeedbackPosted;
    mapping(uint256 => bool) public protocolFeedbackPosted;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event ResearcherFeedback(uint256 indexed escrowId, uint256 indexed agentId, string tag);
    event ProtocolFeedback(uint256 indexed escrowId, uint256 indexed agentId, string outcome);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error NotTee();
    error EscrowNotTerminal();
    error AlreadyPosted();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(address _registry, address _escrow) {
        registry = IReputationRegistry(_registry);
        escrow = MnemoEscrow(_escrow);
    }

    // -----------------------------------------------------------------------
    // Post reputation (TEE only)
    // -----------------------------------------------------------------------

    /**
     * @notice Post researcher reputation after escrow resolution.
     *         Includes severity tag (e.g., "critical", "high", "medium").
     * @param escrowId   The resolved escrow
     * @param agentId    ERC-8004 agent ID of the researcher
     * @param value      Rating value (e.g., 100 = positive, -100 = negative)
     * @param severityTag Vulnerability severity (e.g., "critical", "high")
     * @param feedbackHash Hash of off-chain feedback details stored in TEE
     */
    function postResearcherFeedback(
        uint256 escrowId,
        uint256 agentId,
        int128 value,
        string calldata severityTag,
        bytes32 feedbackHash
    ) external {
        _requireTee(escrowId);
        _requireTerminal(escrowId);
        if (researcherFeedbackPosted[escrowId]) revert AlreadyPosted();

        researcherFeedbackPosted[escrowId] = true;

        // tag1 = "mnemo-disclosure", tag2 = severity
        // endpoint = "" (not relevant), feedbackURI = "" (details in TEE)
        registry.giveFeedback(
            agentId,
            value,
            0, // no decimals
            "mnemo-disclosure",
            severityTag,
            "",
            "",
            feedbackHash
        );

        emit ResearcherFeedback(escrowId, agentId, severityTag);
    }

    /**
     * @notice Post protocol reputation after escrow resolution.
     *         Only includes outcome tag (paid/disputed/ghosted) — no severity leaked.
     * @param escrowId    The resolved escrow
     * @param agentId     ERC-8004 agent ID of the protocol
     * @param value       Rating value
     * @param outcomeTag  "paid", "disputed", or "ghosted"
     * @param feedbackHash Hash of off-chain feedback details stored in TEE
     */
    function postProtocolFeedback(
        uint256 escrowId,
        uint256 agentId,
        int128 value,
        string calldata outcomeTag,
        bytes32 feedbackHash
    ) external {
        _requireTee(escrowId);
        _requireTerminal(escrowId);
        if (protocolFeedbackPosted[escrowId]) revert AlreadyPosted();

        protocolFeedbackPosted[escrowId] = true;

        // tag1 = "mnemo-protocol", tag2 = outcome (no severity!)
        registry.giveFeedback(
            agentId,
            value,
            0,
            "mnemo-protocol",
            outcomeTag,
            "",
            "",
            feedbackHash
        );

        emit ProtocolFeedback(escrowId, agentId, outcomeTag);
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _requireTee(uint256 escrowId) internal view {
        (address tee,,,,,,) = escrow.escrows(escrowId);
        if (msg.sender != tee) revert NotTee();
    }

    function _requireTerminal(uint256 escrowId) internal view {
        (,,,,,, MnemoEscrow.Status status) = escrow.escrows(escrowId);
        if (
            status != MnemoEscrow.Status.Released &&
            status != MnemoEscrow.Status.Refunded &&
            status != MnemoEscrow.Status.Expired
        ) revert EscrowNotTerminal();
    }
}
