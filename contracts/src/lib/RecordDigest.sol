// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RecordDigest
 * @notice The one place the record digest is defined, for both languages.
 *
 * The digest is what makes a record reproducible: an off-chain tool can rebuild
 * it from the fields it was given and check that the chain stores the same
 * bytes. Because the digest includes the chain id and the registry address, a
 * record from one deployment can never be replayed into another.
 *
 * `packages/core/src/record.ts` mirrors this formula, and
 * `contracts/test/RecordDigest.t.sol` plus `packages/core/test/record.test.ts`
 * pin the same expected value, so a change on one side fails the other.
 */
library RecordDigest {
    /// @dev Bumping this tag is a format change, not a bug fix.
    bytes32 internal constant TAG = keccak256("MuseNameRecord/1");

    struct Fields {
        uint256 chainId;
        address registry;
        bytes32 node;
        address ownerAtIssue;
        address actor;
        uint8 kind;
        uint8 verdict;
        uint64 issuedAt;
        bytes32 standardHash;
        bytes32 evidenceHash;
        uint256 refRecordId;
    }

    function compute(Fields memory fields) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    TAG,
                    fields.chainId,
                    fields.registry,
                    fields.node,
                    fields.ownerAtIssue,
                    fields.actor,
                    fields.kind,
                    fields.verdict,
                    fields.issuedAt,
                    fields.standardHash,
                    fields.evidenceHash,
                    fields.refRecordId
                )
            );
    }

    /**
     * @notice The anti-inflation key: the same claim about the same owner twice.
     * @dev The owner is part of the key so that the same verdict about a new owner
     *      is a new record — a bought name must not inherit a history.
     */
    function dedupeKey(Fields memory fields) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    fields.node,
                    fields.ownerAtIssue,
                    fields.actor,
                    fields.kind,
                    fields.verdict,
                    fields.standardHash,
                    fields.evidenceHash
                )
            );
    }
}
