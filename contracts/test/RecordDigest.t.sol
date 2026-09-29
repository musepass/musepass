// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {RecordDigest} from "../src/lib/RecordDigest.sol";

/**
 * The digest is a format, and a format that only exists in Solidity is a format
 * that will disagree with the tooling written in TypeScript. These fixtures pin
 * the same bytes as `packages/core/test/record.test.ts`; a change to either side
 * fails the other side's tests, which is the point.
 */
contract RecordDigestTest is Test {
    function _fixture() internal pure returns (RecordDigest.Fields memory) {
        return
            RecordDigest.Fields({
                chainId: 4663,
                registry: 0x1111111111111111111111111111111111111111,
                node: 0x2222222222222222222222222222222222222222222222222222222222222222,
                ownerAtIssue: 0x3333333333333333333333333333333333333333,
                actor: 0x4444444444444444444444444444444444444444,
                kind: 0, // Verdict
                verdict: 1, // Fail
                issuedAt: 1_790_000_000,
                standardHash: 0x5555555555555555555555555555555555555555555555555555555555555555,
                evidenceHash: 0x6666666666666666666666666666666666666666666666666666666666666666,
                refRecordId: 0
            });
    }

    function test_DigestFixture_MatchesTheTypeScriptImplementation() public pure {
        // Same value as packages/core/test/record.test.ts. If one side changes
        // the field order or the tag, this fails.
        assertEq(
            RecordDigest.compute(_fixture()),
            bytes32(0x1a124827b12ed10cbe8bbde11611aa8b9dcb21fba4d6a114dc27f33a7d1499bc)
        );
    }

    function test_DigestChangesWithEveryField() public pure {
        RecordDigest.Fields memory base = _fixture();
        bytes32 original = RecordDigest.compute(base);

        RecordDigest.Fields memory other = _fixture();
        other.ownerAtIssue = 0x7777777777777777777777777777777777777777;
        assertTrue(RecordDigest.compute(other) != original, "owner");

        other = _fixture();
        other.verdict = 0;
        assertTrue(RecordDigest.compute(other) != original, "verdict");

        other = _fixture();
        other.issuedAt = 1_790_000_001;
        assertTrue(RecordDigest.compute(other) != original, "issuedAt");

        other = _fixture();
        other.chainId = 1;
        assertTrue(RecordDigest.compute(other) != original, "chain id, so a record cannot be replayed across chains");

        other = _fixture();
        other.registry = 0x9999999999999999999999999999999999999999;
        assertTrue(RecordDigest.compute(other) != original, "registry, so a record cannot be replayed across deployments");

        other = _fixture();
        other.refRecordId = 9;
        assertTrue(RecordDigest.compute(other) != original, "dispute reference");
    }

    function test_DedupeKey_IgnoresTimeAndReferenceButNotOwner() public pure {
        RecordDigest.Fields memory base = _fixture();
        bytes32 key = RecordDigest.dedupeKey(base);

        RecordDigest.Fields memory later = _fixture();
        later.issuedAt = 1_800_000_000;
        assertEq(RecordDigest.dedupeKey(later), key, "the same claim later in the day is the same claim");

        RecordDigest.Fields memory otherOwner = _fixture();
        otherOwner.ownerAtIssue = 0x8888888888888888888888888888888888888888;
        assertTrue(RecordDigest.dedupeKey(otherOwner) != key, "a new owner starts a new history");

        RecordDigest.Fields memory otherEvidence = _fixture();
        otherEvidence.evidenceHash = 0x9999999999999999999999999999999999999999999999999999999999999999;
        assertTrue(RecordDigest.dedupeKey(otherEvidence) != key, "a re-verification brings new evidence");
    }
}
