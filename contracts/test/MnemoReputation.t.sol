// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MnemoEscrow} from "../src/MnemoEscrow.sol";
import {MnemoReputation, IReputationRegistry} from "../src/MnemoReputation.sol";

/// @dev Mock ERC-8004 Reputation Registry for testing
contract MockReputationRegistry is IReputationRegistry {
    struct FeedbackEntry {
        uint256 agentId;
        int128 value;
        string tag1;
        string tag2;
        bytes32 feedbackHash;
    }

    FeedbackEntry[] public feedbacks;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8,
        string calldata tag1,
        string calldata tag2,
        string calldata,
        string calldata,
        bytes32 feedbackHash
    ) external {
        feedbacks.push(FeedbackEntry(agentId, value, tag1, tag2, feedbackHash));
    }

    function feedbackCount() external view returns (uint256) {
        return feedbacks.length;
    }
}

contract MnemoReputationTest is Test {
    MnemoEscrow escrowContract;
    MockReputationRegistry registry;
    MnemoReputation reputation;

    address tee = makeAddr("tee");
    address payable funder = payable(makeAddr("funder"));
    address payable payee = payable(makeAddr("payee"));

    uint256 constant AMOUNT = 1 ether;
    uint256 constant DEADLINE = 7 days;
    bytes32 constant COMMIT = keccak256("room-1::nonce");

    uint256 researcherAgentId = 42;
    uint256 protocolAgentId = 99;

    function setUp() public {
        escrowContract = new MnemoEscrow();
        registry = new MockReputationRegistry();
        reputation = new MnemoReputation(address(registry), address(escrowContract));
        vm.deal(funder, 10 ether);
    }

    function _createAndFundAndRelease() internal returns (uint256) {
        vm.prank(tee);
        uint256 id = escrowContract.create(funder, payee, AMOUNT, block.timestamp + DEADLINE, COMMIT);
        vm.prank(funder);
        escrowContract.fund{value: AMOUNT}(id);
        vm.prank(tee);
        escrowContract.release(id);
        return id;
    }

    function _createAndFundAndRefund() internal returns (uint256) {
        vm.prank(tee);
        uint256 id = escrowContract.create(funder, payee, AMOUNT, block.timestamp + DEADLINE, COMMIT);
        vm.prank(funder);
        escrowContract.fund{value: AMOUNT}(id);
        vm.prank(tee);
        escrowContract.refund(id);
        return id;
    }

    // -----------------------------------------------------------------------
    // Researcher feedback
    // -----------------------------------------------------------------------

    function test_postResearcherFeedback() public {
        uint256 id = _createAndFundAndRelease();
        bytes32 hash = keccak256("detailed-feedback");

        vm.prank(tee);
        reputation.postResearcherFeedback(id, researcherAgentId, 100, "critical", hash);

        assertEq(registry.feedbackCount(), 1);
        (uint256 agentId, int128 value, string memory tag1, string memory tag2, bytes32 fHash) = registry.feedbacks(0);
        assertEq(agentId, researcherAgentId);
        assertEq(value, 100);
        assertEq(tag1, "mnemo-disclosure");
        assertEq(tag2, "critical");
        assertEq(fHash, hash);
    }

    function test_postResearcherFeedback_afterRefund() public {
        uint256 id = _createAndFundAndRefund();

        vm.prank(tee);
        reputation.postResearcherFeedback(id, researcherAgentId, -50, "invalid", keccak256("bad-poc"));

        assertEq(registry.feedbackCount(), 1);
    }

    function test_postResearcherFeedback_reverts_notTee() public {
        uint256 id = _createAndFundAndRelease();

        vm.prank(funder);
        vm.expectRevert(MnemoReputation.NotTee.selector);
        reputation.postResearcherFeedback(id, researcherAgentId, 100, "critical", bytes32(0));
    }

    function test_postResearcherFeedback_reverts_notTerminal() public {
        vm.prank(tee);
        uint256 id = escrowContract.create(funder, payee, AMOUNT, block.timestamp + DEADLINE, COMMIT);
        vm.prank(funder);
        escrowContract.fund{value: AMOUNT}(id);
        // Still in Funded state

        vm.prank(tee);
        vm.expectRevert(MnemoReputation.EscrowNotTerminal.selector);
        reputation.postResearcherFeedback(id, researcherAgentId, 100, "critical", bytes32(0));
    }

    function test_postResearcherFeedback_reverts_doublePost() public {
        uint256 id = _createAndFundAndRelease();

        vm.prank(tee);
        reputation.postResearcherFeedback(id, researcherAgentId, 100, "critical", bytes32(0));

        vm.prank(tee);
        vm.expectRevert(MnemoReputation.AlreadyPosted.selector);
        reputation.postResearcherFeedback(id, researcherAgentId, 100, "critical", bytes32(0));
    }

    // -----------------------------------------------------------------------
    // Protocol feedback
    // -----------------------------------------------------------------------

    function test_postProtocolFeedback() public {
        uint256 id = _createAndFundAndRelease();
        bytes32 hash = keccak256("protocol-feedback");

        vm.prank(tee);
        reputation.postProtocolFeedback(id, protocolAgentId, 80, "paid", hash);

        assertEq(registry.feedbackCount(), 1);
        (uint256 agentId, int128 value, string memory tag1, string memory tag2, bytes32 fHash) = registry.feedbacks(0);
        assertEq(agentId, protocolAgentId);
        assertEq(value, 80);
        assertEq(tag1, "mnemo-protocol");
        assertEq(tag2, "paid");
        assertEq(fHash, hash);
    }

    function test_postProtocolFeedback_reverts_doublePost() public {
        uint256 id = _createAndFundAndRelease();

        vm.prank(tee);
        reputation.postProtocolFeedback(id, protocolAgentId, 80, "paid", bytes32(0));

        vm.prank(tee);
        vm.expectRevert(MnemoReputation.AlreadyPosted.selector);
        reputation.postProtocolFeedback(id, protocolAgentId, 80, "paid", bytes32(0));
    }

    // -----------------------------------------------------------------------
    // Asymmetric detail
    // -----------------------------------------------------------------------

    function test_asymmetricDetail() public {
        uint256 id = _createAndFundAndRelease();

        // Researcher gets severity tag
        vm.prank(tee);
        reputation.postResearcherFeedback(id, researcherAgentId, 100, "critical", bytes32(0));

        // Protocol gets only outcome — no severity
        vm.prank(tee);
        reputation.postProtocolFeedback(id, protocolAgentId, 80, "paid", bytes32(0));

        assertEq(registry.feedbackCount(), 2);

        // Verify: researcher feedback has severity, protocol feedback does not
        (, , , string memory researcherTag2, ) = registry.feedbacks(0);
        (, , , string memory protocolTag2, ) = registry.feedbacks(1);

        assertEq(researcherTag2, "critical"); // severity visible
        assertEq(protocolTag2, "paid");       // only outcome, no severity
    }
}
