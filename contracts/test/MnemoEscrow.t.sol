// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MnemoEscrow} from "../src/MnemoEscrow.sol";

contract MnemoEscrowTest is Test {
    MnemoEscrow escrow;

    address tee = makeAddr("tee");
    address payable funder = payable(makeAddr("funder"));
    address payable payee = payable(makeAddr("payee"));

    uint256 constant AMOUNT = 1 ether;
    uint256 constant DEADLINE = 7 days;
    bytes32 constant COMMIT = keccak256("room-1::nonce-abc");

    function setUp() public {
        escrow = new MnemoEscrow();
        vm.deal(funder, 10 ether);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _create() internal returns (uint256) {
        vm.prank(tee);
        return escrow.create(funder, payee, AMOUNT, block.timestamp + DEADLINE, COMMIT);
    }

    function _fund(uint256 id) internal {
        vm.prank(funder);
        escrow.fund{value: AMOUNT}(id);
    }

    // -----------------------------------------------------------------------
    // Create
    // -----------------------------------------------------------------------

    function test_create() public {
        uint256 id = _create();
        MnemoEscrow.Escrow memory e = escrow.getEscrow(id);

        assertEq(e.tee, tee);
        assertEq(e.funder, funder);
        assertEq(e.payee, payee);
        assertEq(e.amount, AMOUNT);
        assertEq(e.commitHash, COMMIT);
        assertEq(uint8(e.status), uint8(MnemoEscrow.Status.Created));
    }

    function test_create_incrementsId() public {
        uint256 a = _create();
        uint256 b = _create();
        assertEq(b, a + 1);
    }

    function test_create_reverts_zeroAmount() public {
        vm.prank(tee);
        vm.expectRevert(MnemoEscrow.InvalidAmount.selector);
        escrow.create(funder, payee, 0, block.timestamp + DEADLINE, COMMIT);
    }

    function test_create_reverts_pastDeadline() public {
        vm.prank(tee);
        vm.expectRevert(MnemoEscrow.InvalidDeadline.selector);
        escrow.create(funder, payee, AMOUNT, block.timestamp, COMMIT);
    }

    // -----------------------------------------------------------------------
    // Fund
    // -----------------------------------------------------------------------

    function test_fund() public {
        uint256 id = _create();
        _fund(id);

        MnemoEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(MnemoEscrow.Status.Funded));
        assertEq(address(escrow).balance, AMOUNT);
    }

    function test_fund_reverts_notFunder() public {
        uint256 id = _create();
        vm.deal(address(0xBEEF), 10 ether);
        vm.prank(address(0xBEEF));
        vm.expectRevert(MnemoEscrow.NotFunder.selector);
        escrow.fund{value: AMOUNT}(id);
    }

    function test_fund_reverts_wrongAmount() public {
        uint256 id = _create();
        vm.prank(funder);
        vm.expectRevert(MnemoEscrow.WrongAmount.selector);
        escrow.fund{value: 0.5 ether}(id);
    }

    function test_fund_reverts_alreadyFunded() public {
        uint256 id = _create();
        _fund(id);
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(
                MnemoEscrow.WrongStatus.selector,
                MnemoEscrow.Status.Created,
                MnemoEscrow.Status.Funded
            )
        );
        escrow.fund{value: AMOUNT}(id);
    }

    // -----------------------------------------------------------------------
    // Release
    // -----------------------------------------------------------------------

    function test_release() public {
        uint256 id = _create();
        _fund(id);

        uint256 payeeBefore = payee.balance;

        vm.prank(tee);
        escrow.release(id);

        MnemoEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(MnemoEscrow.Status.Released));
        assertEq(payee.balance, payeeBefore + AMOUNT);
        assertEq(address(escrow).balance, 0);
    }

    function test_release_reverts_notTee() public {
        uint256 id = _create();
        _fund(id);

        vm.prank(funder);
        vm.expectRevert(MnemoEscrow.NotTee.selector);
        escrow.release(id);
    }

    function test_release_reverts_notFunded() public {
        uint256 id = _create();

        vm.prank(tee);
        vm.expectRevert(
            abi.encodeWithSelector(
                MnemoEscrow.WrongStatus.selector,
                MnemoEscrow.Status.Funded,
                MnemoEscrow.Status.Created
            )
        );
        escrow.release(id);
    }

    // -----------------------------------------------------------------------
    // Refund
    // -----------------------------------------------------------------------

    function test_refund() public {
        uint256 id = _create();
        _fund(id);

        uint256 funderBefore = funder.balance;

        vm.prank(tee);
        escrow.refund(id);

        MnemoEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(MnemoEscrow.Status.Refunded));
        assertEq(funder.balance, funderBefore + AMOUNT);
    }

    function test_refund_reverts_notTee() public {
        uint256 id = _create();
        _fund(id);

        vm.prank(payee);
        vm.expectRevert(MnemoEscrow.NotTee.selector);
        escrow.refund(id);
    }

    // -----------------------------------------------------------------------
    // Expiry
    // -----------------------------------------------------------------------

    function test_claimExpired() public {
        uint256 id = _create();
        _fund(id);

        uint256 funderBefore = funder.balance;

        // Warp past deadline
        vm.warp(block.timestamp + DEADLINE + 1);

        // Anyone can trigger
        vm.prank(address(0xCAFE));
        escrow.claimExpired(id);

        MnemoEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(MnemoEscrow.Status.Expired));
        assertEq(funder.balance, funderBefore + AMOUNT);
    }

    function test_claimExpired_reverts_notExpired() public {
        uint256 id = _create();
        _fund(id);

        vm.expectRevert(MnemoEscrow.NotExpired.selector);
        escrow.claimExpired(id);
    }

    function test_claimExpired_reverts_notFunded() public {
        uint256 id = _create();

        vm.warp(block.timestamp + DEADLINE + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                MnemoEscrow.WrongStatus.selector,
                MnemoEscrow.Status.Funded,
                MnemoEscrow.Status.Created
            )
        );
        escrow.claimExpired(id);
    }

    // -----------------------------------------------------------------------
    // Double-action prevention
    // -----------------------------------------------------------------------

    function test_cannotReleaseAfterRefund() public {
        uint256 id = _create();
        _fund(id);

        vm.prank(tee);
        escrow.refund(id);

        vm.prank(tee);
        vm.expectRevert(
            abi.encodeWithSelector(
                MnemoEscrow.WrongStatus.selector,
                MnemoEscrow.Status.Funded,
                MnemoEscrow.Status.Refunded
            )
        );
        escrow.release(id);
    }

    function test_cannotRefundAfterRelease() public {
        uint256 id = _create();
        _fund(id);

        vm.prank(tee);
        escrow.release(id);

        vm.prank(tee);
        vm.expectRevert(
            abi.encodeWithSelector(
                MnemoEscrow.WrongStatus.selector,
                MnemoEscrow.Status.Funded,
                MnemoEscrow.Status.Released
            )
        );
        escrow.refund(id);
    }
}
