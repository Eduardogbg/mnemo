// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MnemoRegistry
 * @notice Protocol registration for the Mnemo bug disclosure network.
 *
 *  Protocols register here so autonomous security researcher agents can
 *  discover them.  The registry is deliberately independent from MnemoEscrow
 *  — no on-chain link between a registry entry and an escrow exists, so
 *  observers cannot correlate which listing a disclosure belongs to.
 *
 *  Rich bounty terms (per-severity ranges, scope, compiler info) live in
 *  IPFS metadata pointed to by `metadataURI`. On-chain we only store the
 *  `maxBounty` ceiling as a signal for agent filtering.
 */
contract MnemoRegistry {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    struct Protocol {
        address owner;          // Address that registered (can update/deactivate)
        string metadataURI;     // IPFS CID pointing to: contract addresses, source code, bounty terms, scope
        uint256 maxBounty;      // Maximum bounty in wei (so agents can filter by reward)
        bool active;            // Can be deactivated by owner
        uint256 registeredAt;   // Block timestamp
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    uint256 public nextProtocolId;
    mapping(uint256 => Protocol) public protocols;

    // -----------------------------------------------------------------------
    // Events — agents watch these for discovery
    // -----------------------------------------------------------------------

    event ProtocolRegistered(
        uint256 indexed protocolId,
        address indexed owner,
        string metadataURI,
        uint256 maxBounty
    );

    event ProtocolUpdated(uint256 indexed protocolId, string metadataURI, uint256 maxBounty);
    event ProtocolDeactivated(uint256 indexed protocolId);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error NotOwner();
    error ZeroBounty();
    error AlreadyInactive();

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    /**
     * @notice Register a protocol for auditing. Caller becomes owner.
     * @param metadataURI  IPFS CID pointing to contract addresses, source, bounty terms, scope
     * @param maxBounty    Maximum bounty in wei (must be > 0)
     * @return protocolId  The ID of the newly created listing
     */
    function register(
        string calldata metadataURI,
        uint256 maxBounty
    ) external returns (uint256 protocolId) {
        if (maxBounty == 0) revert ZeroBounty();

        protocolId = nextProtocolId++;
        protocols[protocolId] = Protocol({
            owner: msg.sender,
            metadataURI: metadataURI,
            maxBounty: maxBounty,
            active: true,
            registeredAt: block.timestamp
        });

        emit ProtocolRegistered(protocolId, msg.sender, metadataURI, maxBounty);
    }

    // -----------------------------------------------------------------------
    // Management
    // -----------------------------------------------------------------------

    /**
     * @notice Update metadata and/or bounty for an existing listing.
     * @param protocolId   The listing to update
     * @param metadataURI  New IPFS CID
     * @param maxBounty    New maximum bounty in wei (must be > 0)
     */
    function update(
        uint256 protocolId,
        string calldata metadataURI,
        uint256 maxBounty
    ) external {
        Protocol storage p = protocols[protocolId];
        if (msg.sender != p.owner) revert NotOwner();
        if (maxBounty == 0) revert ZeroBounty();

        p.metadataURI = metadataURI;
        p.maxBounty = maxBounty;

        emit ProtocolUpdated(protocolId, metadataURI, maxBounty);
    }

    /**
     * @notice Deactivate a listing. Agents will stop targeting this protocol.
     * @param protocolId  The listing to deactivate
     */
    function deactivate(uint256 protocolId) external {
        Protocol storage p = protocols[protocolId];
        if (msg.sender != p.owner) revert NotOwner();
        if (!p.active) revert AlreadyInactive();

        p.active = false;

        emit ProtocolDeactivated(protocolId);
    }

    // -----------------------------------------------------------------------
    // View
    // -----------------------------------------------------------------------

    function getProtocol(uint256 protocolId) external view returns (Protocol memory) {
        return protocols[protocolId];
    }

    function isActive(uint256 protocolId) external view returns (bool) {
        return protocols[protocolId].active;
    }
}
