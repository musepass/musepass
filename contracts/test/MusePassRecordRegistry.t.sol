// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {INameOwner} from "../src/interfaces/INameOwner.sol";
import {MusePassRecordRegistry} from "../src/MusePassRecordRegistry.sol";

/// @dev Only the one function the record registry calls. Fake owners on purpose:
///      the record registry must not care how a name got its owner.
contract MockNameOwner is INameOwner {
    mapping(bytes32 => address) public ownerOf;

    function setOwner(bytes32 node, address owner_) external {
        ownerOf[node] = owner_;
    }

    function owner(bytes32 node) external view override returns (address) {
        return ownerOf[node];
    }
}

contract MusePassRecordRegistryTest is Test {
    MockNameOwner internal names;
    MusePassRecordRegistry internal registry;

    address internal constant ADMIN = address(0xA11CE);
    address internal constant VERIFIER = address(0xBEEF);
    address internal constant VERIFIER_B = address(0xB0B);
    address internal constant STRANGER = address(0xDEAD);
    address internal constant SUBJECT_OWNER = address(0x603b8B1f7a0Bc152b7D0Dcd7bFfBF1f2Af115f6d);

    bytes32 internal constant NODE = keccak256("xiaoming.musepass.eth");
    bytes32 internal constant STANDARD = keccak256("deliver 20 photos in 48h");
    bytes32 internal constant EVIDENCE = keccak256("handover bundle");
    bytes32 internal constant EVIDENCE_2 = keccak256("second handover bundle");

    event RecordAppended(
        uint256 indexed recordId,
        bytes32 indexed node,
        address indexed actor,
        MusePassRecordRegistry.Kind kind,
        MusePassRecordRegistry.Verdict verdict,
        address ownerAtIssue,
        bytes32 standardHash,
        bytes32 evidenceHash,
        uint256 refRecordId,
        bytes32 digest
    );
    event VerifierSet(address indexed verifier, bool allowed);
    event AdminRenouncedPermanently();

    function setUp() public {
        names = new MockNameOwner();
        names.setOwner(NODE, SUBJECT_OWNER);
        registry = new MusePassRecordRegistry(address(names), ADMIN);

        vm.prank(ADMIN);
        registry.setVerifier(VERIFIER, true);
    }

    /*//////////////////////////////////////////////////////////////
                              HAPPY PATHS
    //////////////////////////////////////////////////////////////*/

    function test_AppendVerdict_StoresEverythingTheVerifierClaimed() public {
        vm.prank(VERIFIER);
        uint256 recordId = registry.appendVerdict(
            NODE,
            STANDARD,
            EVIDENCE,
            MusePassRecordRegistry.Verdict.Pass
        );

        MusePassRecordRegistry.Record memory record = registry.getRecord(recordId);
        assertEq(record.node, NODE);
        assertEq(record.ownerAtIssue, SUBJECT_OWNER, "owner is read from the name registry");
        assertEq(record.actor, VERIFIER);
        assertEq(uint8(record.kind), uint8(MusePassRecordRegistry.Kind.Verdict));
        assertEq(uint8(record.verdict), uint8(MusePassRecordRegistry.Verdict.Pass));
        assertEq(record.standardHash, STANDARD);
        assertEq(record.evidenceHash, EVIDENCE);
        assertEq(record.refRecordId, 0);
        assertEq(record.issuedAt, uint64(block.timestamp));
        assertEq(registry.recordCount(), 1);
    }

    function test_AppendVerdict_DigestIsReproducibleFromTheFields() public {
        vm.prank(VERIFIER);
        uint256 recordId = registry.appendVerdict(
            NODE,
            STANDARD,
            EVIDENCE,
            MusePassRecordRegistry.Verdict.Fail
        );
        MusePassRecordRegistry.Record memory record = registry.getRecord(recordId);

        bytes32 recomputed = registry.computeDigest(
            record.node,
            record.ownerAtIssue,
            record.actor,
            record.verdict,
            record.kind,
            record.issuedAt,
            record.standardHash,
            record.evidenceHash,
            record.refRecordId
        );
        assertEq(record.digest, recomputed, "the stored digest must be recomputable");
    }

    function test_AppendVerdict_EmitsTheRecord() public {
        bytes32 expectedDigest = registry.computeDigest(
            NODE,
            SUBJECT_OWNER,
            VERIFIER,
            MusePassRecordRegistry.Verdict.Pass,
            MusePassRecordRegistry.Kind.Verdict,
            uint64(block.timestamp),
            STANDARD,
            EVIDENCE,
            0
        );

        vm.expectEmit(true, true, true, true, address(registry));
        emit RecordAppended(
            0,
            NODE,
            VERIFIER,
            MusePassRecordRegistry.Kind.Verdict,
            MusePassRecordRegistry.Verdict.Pass,
            SUBJECT_OWNER,
            STANDARD,
            EVIDENCE,
            0,
            expectedDigest
        );

        vm.prank(VERIFIER);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
    }

    function test_Summary_KeepsTheThreeOutcomesApart() public {
        vm.startPrank(VERIFIER);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE_2, MusePassRecordRegistry.Verdict.Pass);
        registry.appendVerdict(NODE, keccak256("another standard"), EVIDENCE, MusePassRecordRegistry.Verdict.Fail);
        registry.appendVerdict(NODE, keccak256("unprovable standard"), EVIDENCE, MusePassRecordRegistry.Verdict.Unproven);
        vm.stopPrank();

        (uint32 pass, uint32 fail, uint32 unproven, uint32 disputes) = registry.summaryOf(NODE);
        assertEq(pass, 2);
        assertEq(fail, 1);
        assertEq(unproven, 1, "unproven is counted on its own, never folded into a pass rate");
        assertEq(disputes, 0);
    }

    /*//////////////////////////////////////////////////////////////
                          WHO MAY WRITE, AND WHAT
    //////////////////////////////////////////////////////////////*/

    function test_AppendVerdict_RevertsForAnUnregisteredVerifier() public {
        vm.prank(STRANGER);
        vm.expectRevert(MusePassRecordRegistry.Unauthorized.selector);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
    }

    function test_AppendVerdict_RevertsForANameNobodyOwns() public {
        bytes32 orphan = keccak256("nobody.musepass.eth");
        vm.prank(VERIFIER);
        vm.expectRevert(abi.encodeWithSelector(MusePassRecordRegistry.NotRegistered.selector, orphan));
        registry.appendVerdict(orphan, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
    }

    function test_AppendVerdict_RevertsForAVerdictOutsideTheEnum() public {
        // Crafted by hand, because Solidity refuses the conversion inside the
        // test itself — which is exactly why the check has to exist on chain.
        bytes memory data = abi.encodeWithSignature(
            "appendVerdict(bytes32,bytes32,bytes32,uint8)",
            NODE,
            STANDARD,
            EVIDENCE,
            uint8(3)
        );
        vm.prank(VERIFIER);
        (bool ok, ) = address(registry).call(data);
        assertFalse(ok, "an out-of-range verdict must not be accepted");
        assertEq(registry.recordCount(), 0, "and it must not leave a record behind");
    }

    function test_AppendVerdict_RevertsOnAnIdenticalClaim() public {
        vm.startPrank(VERIFIER);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);

        bytes32 dedupeKey = keccak256(
            abi.encode(
                NODE,
                SUBJECT_OWNER,
                VERIFIER,
                MusePassRecordRegistry.Kind.Verdict,
                MusePassRecordRegistry.Verdict.Pass,
                STANDARD,
                EVIDENCE
            )
        );
        vm.expectRevert(abi.encodeWithSelector(MusePassRecordRegistry.DuplicateRecord.selector, dedupeKey));
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
        vm.stopPrank();
    }

    function test_Summary_CountsASecondVerifierSeparatelyFromTheFirst() public {
        vm.prank(ADMIN);
        registry.setVerifier(VERIFIER_B, true);

        vm.prank(VERIFIER);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
        // Same claim, different verifier: allowed, and it is a different voice.
        vm.prank(VERIFIER_B);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);

        (uint32 pass, , , ) = registry.summaryOf(NODE);
        assertEq(pass, 2);
    }

    function test_RemovingAVerifier_StopsNewRecordsButKeepsOldOnes() public {
        vm.prank(VERIFIER);
        uint256 recordId = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);

        vm.prank(ADMIN);
        registry.setVerifier(VERIFIER, false);

        vm.prank(VERIFIER);
        vm.expectRevert(MusePassRecordRegistry.Unauthorized.selector);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE_2, MusePassRecordRegistry.Verdict.Pass);

        assertEq(registry.getRecord(recordId).evidenceHash, EVIDENCE, "history is untouched");
    }

    /*//////////////////////////////////////////////////////////////
                                DISPUTES
    //////////////////////////////////////////////////////////////*/

    function test_RaiseDispute_IsPermissionlessAndAppends() public {
        vm.prank(VERIFIER);
        uint256 original = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);

        vm.prank(STRANGER);
        uint256 disputeId = registry.raiseDispute(original, keccak256("the photos were late"));

        MusePassRecordRegistry.Record memory dispute = registry.getRecord(disputeId);
        assertEq(uint8(dispute.kind), uint8(MusePassRecordRegistry.Kind.Dispute));
        assertEq(dispute.actor, STRANGER);
        assertEq(dispute.refRecordId, original);
        assertEq(dispute.node, NODE);
        assertEq(uint8(dispute.verdict), uint8(MusePassRecordRegistry.Verdict.Unproven), "a dispute is not a verdict");

        // The original is still there, byte for byte.
        MusePassRecordRegistry.Record memory untouched = registry.getRecord(original);
        assertEq(untouched.evidenceHash, EVIDENCE);
        assertEq(uint8(untouched.verdict), uint8(MusePassRecordRegistry.Verdict.Pass));

        (uint32 pass, , , uint32 disputes) = registry.summaryOf(NODE);
        assertEq(pass, 1);
        assertEq(disputes, 1);
    }

    function test_RaiseDispute_RevertsForAnUnknownRecord() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(MusePassRecordRegistry.UnknownRecord.selector, 7));
        registry.raiseDispute(7, EVIDENCE);
    }

    function test_RaiseDispute_CannotTargetAnotherDispute() public {
        vm.prank(VERIFIER);
        uint256 original = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
        vm.prank(STRANGER);
        uint256 disputeId = registry.raiseDispute(original, EVIDENCE_2);

        vm.prank(STRANGER);
        vm.expectRevert(MusePassRecordRegistry.CannotDisputeADispute.selector);
        registry.raiseDispute(disputeId, EVIDENCE);
    }

    /*//////////////////////////////////////////////////////////////
                                 BATCHES
    //////////////////////////////////////////////////////////////*/

    function test_AnchorBatch_RecordsTheRoot() public {
        bytes32 root = keccak256(abi.encodePacked(EVIDENCE, EVIDENCE_2));

        vm.prank(VERIFIER);
        uint256 batchId = registry.anchorBatch(root, 2, "ipfs://batch");

        MusePassRecordRegistry.Batch memory batch = registry.getBatch(batchId);
        assertEq(batch.root, root);
        assertEq(batch.count, 2);
        assertEq(batch.actor, VERIFIER);
        assertEq(batch.uri, "ipfs://batch");
        assertEq(batch.anchoredAt, uint64(block.timestamp));
        assertEq(registry.batchCount(), 1);
    }

    function test_AnchorBatch_RevertsForANonVerifier() public {
        vm.prank(STRANGER);
        vm.expectRevert(MusePassRecordRegistry.Unauthorized.selector);
        registry.anchorBatch(keccak256("root"), 1, "");
    }

    function test_AnchorBatch_RevertsForAnEmptyBatch() public {
        vm.prank(VERIFIER);
        vm.expectRevert(MusePassRecordRegistry.EmptyBatch.selector);
        registry.anchorBatch(keccak256("root"), 0, "");
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_Admin_IsTheOnlyOneWhoCanChangeTheVerifierSet() public {
        vm.prank(STRANGER);
        vm.expectRevert(MusePassRecordRegistry.Unauthorized.selector);
        registry.setVerifier(STRANGER, true);

        vm.prank(ADMIN);
        registry.setVerifier(VERIFIER_B, true);
        assertTrue(registry.verifiers(VERIFIER_B));
    }

    function test_Admin_EmitsTheVerifierChange() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit VerifierSet(VERIFIER_B, true);
        vm.prank(ADMIN);
        registry.setVerifier(VERIFIER_B, true);
    }

    function test_Admin_TransferHandsOverTheOnlyPower() public {
        vm.prank(ADMIN);
        registry.transferAdmin(STRANGER);
        assertEq(registry.admin(), STRANGER);

        vm.prank(ADMIN);
        vm.expectRevert(MusePassRecordRegistry.Unauthorized.selector);
        registry.setVerifier(VERIFIER_B, true);

        vm.prank(STRANGER);
        registry.setVerifier(VERIFIER_B, true);
        assertTrue(registry.verifiers(VERIFIER_B));
    }

    function test_RenounceAdmin_FreezesTheVerifierSetForever() public {
        vm.prank(VERIFIER);
        uint256 recordId = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);

        vm.expectEmit(false, false, false, false, address(registry));
        emit AdminRenouncedPermanently();
        vm.prank(ADMIN);
        registry.renounceAdmin();

        vm.prank(ADMIN);
        vm.expectRevert(MusePassRecordRegistry.AdminRenounced.selector);
        registry.setVerifier(VERIFIER_B, true);

        // Freezing the set must not freeze the history, and it must not lock out
        // the verifiers that were already registered.
        assertEq(registry.getRecord(recordId).evidenceHash, EVIDENCE);
        vm.prank(VERIFIER);
        registry.appendVerdict(NODE, STANDARD, EVIDENCE_2, MusePassRecordRegistry.Verdict.Pass);
    }

    /*//////////////////////////////////////////////////////////////
                        WHAT THIS CONTRACT MUST NOT DO
    //////////////////////////////////////////////////////////////*/

    function test_HoldsNoFunds_AndRejectsEther() public {
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        (bool ok, ) = address(registry).call{value: 1 ether}("");
        assertFalse(ok, "no fallback, no receive: ether must bounce");
        assertEq(address(registry).balance, 0);
    }

    function test_RecordSurvivesEveryLaterOperation() public {
        vm.prank(VERIFIER);
        uint256 recordId = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
        bytes32 digestBefore = registry.getRecord(recordId).digest;

        vm.prank(STRANGER);
        registry.raiseDispute(recordId, EVIDENCE_2);
        vm.prank(VERIFIER);
        registry.anchorBatch(keccak256("root"), 1, "");
        vm.prank(ADMIN);
        registry.setVerifier(VERIFIER_B, true);
        vm.prank(ADMIN);
        registry.transferAdmin(STRANGER);

        MusePassRecordRegistry.Record memory after_ = registry.getRecord(recordId);
        assertEq(after_.digest, digestBefore);
        assertEq(after_.evidenceHash, EVIDENCE);
        assertEq(uint8(after_.verdict), uint8(MusePassRecordRegistry.Verdict.Pass));
        assertEq(registry.recordCount(), 2, "a dispute adds a record, it never replaces one");
    }

    function test_OwnershipChangeDoesNotMoveOldRecords() public {
        vm.prank(VERIFIER);
        uint256 recordId = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);

        names.setOwner(NODE, STRANGER);

        // The old record still says who owned the name when it was issued...
        assertEq(registry.getRecord(recordId).ownerAtIssue, SUBJECT_OWNER);
        // ...and the same claim restated now is a new record about the new owner,
        // which is what lets a reader see "this history belongs to the previous
        // owner" instead of lending it to whoever bought the name.
        vm.prank(VERIFIER);
        uint256 fresh = registry.appendVerdict(NODE, STANDARD, EVIDENCE, MusePassRecordRegistry.Verdict.Pass);
        assertEq(registry.getRecord(fresh).ownerAtIssue, STRANGER);
    }

    function test_Constructor_RejectsZeroAddresses() public {
        vm.expectRevert(MusePassRecordRegistry.ZeroAddress.selector);
        new MusePassRecordRegistry(address(0), ADMIN);

        vm.expectRevert(MusePassRecordRegistry.ZeroAddress.selector);
        new MusePassRecordRegistry(address(names), address(0));
    }
}
