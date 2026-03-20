// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MnemoRegistry} from "../src/MnemoRegistry.sol";

contract MnemoRegistryTest is Test {
    MnemoRegistry registry;

    address owner = makeAddr("owner");
    address stranger = makeAddr("stranger");

    string constant META_URI = "ipfs://QmExampleMetadata";
    string constant META_URI_2 = "ipfs://QmUpdatedMetadata";
    uint256 constant MAX_BOUNTY = 100 ether;
    uint256 constant MAX_BOUNTY_2 = 50 ether;

    function setUp() public {
        registry = new MnemoRegistry();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function _register() internal returns (uint256) {
        vm.prank(owner);
        return registry.register(META_URI, MAX_BOUNTY);
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    function test_register() public {
        vm.expectEmit(true, true, false, true);
        emit MnemoRegistry.ProtocolRegistered(0, owner, META_URI, MAX_BOUNTY);

        uint256 id = _register();

        MnemoRegistry.Protocol memory p = registry.getProtocol(id);
        assertEq(p.owner, owner);
        assertEq(p.metadataURI, META_URI);
        assertEq(p.maxBounty, MAX_BOUNTY);
        assertTrue(p.active);
        assertEq(p.registeredAt, block.timestamp);
    }

    function test_register_incrementsId() public {
        uint256 a = _register();
        uint256 b = _register();
        assertEq(b, a + 1);
    }

    function test_register_reverts_zeroBounty() public {
        vm.prank(owner);
        vm.expectRevert(MnemoRegistry.ZeroBounty.selector);
        registry.register(META_URI, 0);
    }

    // -----------------------------------------------------------------------
    // Update
    // -----------------------------------------------------------------------

    function test_update() public {
        uint256 id = _register();

        vm.expectEmit(true, false, false, true);
        emit MnemoRegistry.ProtocolUpdated(id, META_URI_2, MAX_BOUNTY_2);

        vm.prank(owner);
        registry.update(id, META_URI_2, MAX_BOUNTY_2);

        MnemoRegistry.Protocol memory p = registry.getProtocol(id);
        assertEq(p.metadataURI, META_URI_2);
        assertEq(p.maxBounty, MAX_BOUNTY_2);
    }

    function test_update_reverts_notOwner() public {
        uint256 id = _register();

        vm.prank(stranger);
        vm.expectRevert(MnemoRegistry.NotOwner.selector);
        registry.update(id, META_URI_2, MAX_BOUNTY_2);
    }

    function test_update_reverts_zeroBounty() public {
        uint256 id = _register();

        vm.prank(owner);
        vm.expectRevert(MnemoRegistry.ZeroBounty.selector);
        registry.update(id, META_URI_2, 0);
    }

    // -----------------------------------------------------------------------
    // Deactivate
    // -----------------------------------------------------------------------

    function test_deactivate() public {
        uint256 id = _register();

        vm.expectEmit(true, false, false, false);
        emit MnemoRegistry.ProtocolDeactivated(id);

        vm.prank(owner);
        registry.deactivate(id);

        MnemoRegistry.Protocol memory p = registry.getProtocol(id);
        assertFalse(p.active);
    }

    function test_deactivate_reverts_notOwner() public {
        uint256 id = _register();

        vm.prank(stranger);
        vm.expectRevert(MnemoRegistry.NotOwner.selector);
        registry.deactivate(id);
    }

    function test_deactivate_reverts_alreadyInactive() public {
        uint256 id = _register();

        vm.prank(owner);
        registry.deactivate(id);

        vm.prank(owner);
        vm.expectRevert(MnemoRegistry.AlreadyInactive.selector);
        registry.deactivate(id);
    }

    // -----------------------------------------------------------------------
    // View: getProtocol
    // -----------------------------------------------------------------------

    function test_getProtocol_returnsCorrectData() public {
        uint256 ts = 1_700_000_000;
        vm.warp(ts);

        uint256 id = _register();

        MnemoRegistry.Protocol memory p = registry.getProtocol(id);
        assertEq(p.owner, owner);
        assertEq(p.metadataURI, META_URI);
        assertEq(p.maxBounty, MAX_BOUNTY);
        assertTrue(p.active);
        assertEq(p.registeredAt, ts);
    }

    // -----------------------------------------------------------------------
    // View: isActive
    // -----------------------------------------------------------------------

    function test_isActive_trueAfterRegister() public {
        uint256 id = _register();
        assertTrue(registry.isActive(id));
    }

    function test_isActive_falseAfterDeactivate() public {
        uint256 id = _register();

        vm.prank(owner);
        registry.deactivate(id);

        assertFalse(registry.isActive(id));
    }

    function test_isActive_falseForNonexistent() public view {
        assertFalse(registry.isActive(999));
    }

    // -----------------------------------------------------------------------
    // Multiple protocols
    // -----------------------------------------------------------------------

    function test_multipleProtocols() public {
        vm.prank(owner);
        uint256 id0 = registry.register("ipfs://QmFirst", 10 ether);

        address owner2 = makeAddr("owner2");
        vm.prank(owner2);
        uint256 id1 = registry.register("ipfs://QmSecond", 200 ether);

        assertEq(id0, 0);
        assertEq(id1, 1);

        MnemoRegistry.Protocol memory p0 = registry.getProtocol(id0);
        MnemoRegistry.Protocol memory p1 = registry.getProtocol(id1);

        assertEq(p0.owner, owner);
        assertEq(p0.metadataURI, "ipfs://QmFirst");
        assertEq(p0.maxBounty, 10 ether);

        assertEq(p1.owner, owner2);
        assertEq(p1.metadataURI, "ipfs://QmSecond");
        assertEq(p1.maxBounty, 200 ether);

        // Deactivating one does not affect the other
        vm.prank(owner);
        registry.deactivate(id0);

        assertFalse(registry.isActive(id0));
        assertTrue(registry.isActive(id1));
    }
}
