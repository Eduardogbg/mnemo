// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MnemoEscrow
 * @notice TEE-resolved escrow for private bug disclosure negotiations.
 *
 *  Flow:
 *    1. TEE creates escrow with blind commitment hash (no protocol identity on-chain)
 *    2. Protocol (buyer) funds the escrow
 *    3. TEE resolves: release payment to researcher, or refund to protocol
 *
 *  Privacy: Only the TEE address, commitment hash, and ETH amount are visible on-chain.
 *  Neither the protocol's identity, the researcher's identity, nor the severity are
 *  exposed to on-chain observers.
 */
contract MnemoEscrow {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum Status {
        Created,   // TEE created, awaiting funding
        Funded,    // Protocol deposited funds
        Released,  // TEE released payment to researcher
        Refunded,  // TEE refunded payment to protocol
        Expired    // Past deadline, anyone can trigger refund
    }

    struct Escrow {
        address tee;            // TEE enclave address (sole resolver)
        address payable funder; // Protocol that funds the escrow
        address payable payee;  // Researcher receiving payment on release
        uint256 amount;         // Expected funding amount
        uint256 deadline;       // Unix timestamp — auto-refund after this
        bytes32 commitHash;     // Blind commitment: keccak256(roomId || details || nonce)
        Status status;
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) public escrows;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed tee,
        bytes32 commitHash,
        uint256 amount,
        uint256 deadline
    );

    event EscrowFunded(uint256 indexed escrowId, address indexed funder);
    event EscrowReleased(uint256 indexed escrowId, address indexed payee, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed funder, uint256 amount);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error InvalidAmount();
    error InvalidDeadline();
    error NotFunder();
    error NotTee();
    error WrongStatus(Status expected, Status actual);
    error WrongAmount();
    error NotExpired();
    error TransferFailed();

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyTee(uint256 escrowId) {
        if (msg.sender != escrows[escrowId].tee) revert NotTee();
        _;
    }

    modifier inStatus(uint256 escrowId, Status expected) {
        Status actual = escrows[escrowId].status;
        if (actual != expected) revert WrongStatus(expected, actual);
        _;
    }

    // -----------------------------------------------------------------------
    // Create
    // -----------------------------------------------------------------------

    /**
     * @notice TEE creates an escrow for a negotiation room.
     * @param funder     Address that will fund the escrow (protocol/buyer)
     * @param payee      Address that receives funds on release (researcher)
     * @param amount     Expected funding amount in wei
     * @param deadline   Unix timestamp after which the escrow auto-refunds
     * @param commitHash Blind commitment: keccak256(abi.encodePacked(roomId, nonce))
     * @return escrowId  The ID of the newly created escrow
     */
    function create(
        address payable funder,
        address payable payee,
        uint256 amount,
        uint256 deadline,
        bytes32 commitHash
    ) external returns (uint256 escrowId) {
        if (amount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow({
            tee: msg.sender,
            funder: funder,
            payee: payee,
            amount: amount,
            deadline: deadline,
            commitHash: commitHash,
            status: Status.Created
        });

        emit EscrowCreated(escrowId, msg.sender, commitHash, amount, deadline);
    }

    // -----------------------------------------------------------------------
    // Fund
    // -----------------------------------------------------------------------

    /**
     * @notice Protocol funds the escrow. Must send exactly the expected amount.
     */
    function fund(uint256 escrowId)
        external
        payable
        inStatus(escrowId, Status.Created)
    {
        Escrow storage e = escrows[escrowId];
        if (msg.sender != e.funder) revert NotFunder();
        if (msg.value != e.amount) revert WrongAmount();

        e.status = Status.Funded;
        emit EscrowFunded(escrowId, msg.sender);
    }

    // -----------------------------------------------------------------------
    // Resolve (TEE only)
    // -----------------------------------------------------------------------

    /**
     * @notice TEE releases funds to the researcher (bug verified + accepted).
     */
    function release(uint256 escrowId)
        external
        onlyTee(escrowId)
        inStatus(escrowId, Status.Funded)
    {
        Escrow storage e = escrows[escrowId];
        e.status = Status.Released;

        (bool ok,) = e.payee.call{value: e.amount}("");
        if (!ok) revert TransferFailed();

        emit EscrowReleased(escrowId, e.payee, e.amount);
    }

    /**
     * @notice TEE refunds the protocol (bug invalid or negotiation failed).
     */
    function refund(uint256 escrowId)
        external
        onlyTee(escrowId)
        inStatus(escrowId, Status.Funded)
    {
        Escrow storage e = escrows[escrowId];
        e.status = Status.Refunded;

        (bool ok,) = e.funder.call{value: e.amount}("");
        if (!ok) revert TransferFailed();

        emit EscrowRefunded(escrowId, e.funder, e.amount);
    }

    // -----------------------------------------------------------------------
    // Expiry (permissionless)
    // -----------------------------------------------------------------------

    /**
     * @notice Anyone can trigger a refund after the deadline passes.
     *         Protects the funder if the TEE goes offline.
     */
    function claimExpired(uint256 escrowId)
        external
        inStatus(escrowId, Status.Funded)
    {
        Escrow storage e = escrows[escrowId];
        if (block.timestamp < e.deadline) revert NotExpired();

        e.status = Status.Expired;

        (bool ok,) = e.funder.call{value: e.amount}("");
        if (!ok) revert TransferFailed();

        emit EscrowRefunded(escrowId, e.funder, e.amount);
    }

    // -----------------------------------------------------------------------
    // View
    // -----------------------------------------------------------------------

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }
}
