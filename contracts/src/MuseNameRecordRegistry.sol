// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INameOwner} from "./interfaces/INameOwner.sol";
import {RecordDigest} from "./lib/RecordDigest.sol";

/**
 * @title MuseNameRecordRegistry
 * @notice The append-only record of "what has this name actually done".
 *
 * Design rules, in the order they constrain the code:
 *
 * 1. **Nothing can be changed or removed.** There is no setter for a record, no
 *    delete, no upgrade hook, no `selfdestruct`, no delegatecall. A correction is
 *    a new record, and a dispute is a new record. If the verifier set is wrong,
 *    the fix is visible in an event, not silent.
 * 2. **No funds, no fallback.** The contract is not payable and has no
 *    `receive`/`fallback`, so ETH sent to it reverts instead of being stuck.
 * 3. **A verdict comes from a registered verifier.** Only addresses the admin
 *    has added can append a verdict. Who the admin is, and when it becomes a
 *    multisig, is written down in docs/record-format.md — this contract cannot
 *    promise it, so the documentation cannot either.
 * 4. **The subject is bound at write time.** `ownerAtIssue` is read from the
 *    name registry during the write, not supplied by the verifier. A record can
 *    therefore never be attached to a name nobody owned, and after an ownership
 *    change the old records stay attached to the old address (the new owner
 *    starts from nothing, which is the honest position).
 * 5. **The digest is reproducible off chain.** Every record stores a `digest`
 *    over its own fields, so a batch merkle root can be built from stored data
 *    and recomputed by a third party (`packages/core/src/record.ts` mirrors the
 *    formula, and a test in each language pins the same output).
 *
 * This contract must be externally audited before any paid feature depends on
 * it. It holds no funds, which lowers the stakes but does not remove them: a
 * false verdict is the product failing.
 */
contract MuseNameRecordRegistry {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @dev `Unproven` is a first-class outcome. "We could not establish this"
    ///      must never look like "we established it".
    enum Verdict {
        Pass,
        Fail,
        Unproven
    }

    /// @dev A dispute is appended, never a mutation of the record it disputes.
    enum Kind {
        Verdict,
        Dispute
    }

    struct Record {
        bytes32 node;
        address ownerAtIssue;
        /// @dev The registered verifier for a verdict; whoever raised it for a dispute.
        address actor;
        Verdict verdict;
        Kind kind;
        uint64 issuedAt;
        bytes32 standardHash;
        bytes32 evidenceHash;
        /// @dev For a dispute, the record being disputed. Zero otherwise.
        uint256 refRecordId;
        /// @dev keccak256 over the fields above, per spec in docs/record-format.md.
        bytes32 digest;
    }

    struct Batch {
        bytes32 root;
        uint32 count;
        address actor;
        uint64 anchoredAt;
        string uri;
    }

    /// @dev One bundle of fields, so the append path does not run out of stack.
    struct RecordInput {
        bytes32 node;
        address ownerAtIssue;
        address actor;
        Verdict verdict;
        Kind kind;
        bytes32 standardHash;
        bytes32 evidenceHash;
        uint256 refRecordId;
    }

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error Unauthorized();
    error ZeroAddress();
    error NotRegistered(bytes32 node);
    error InvalidVerdict(uint8 value);
    error UnknownRecord(uint256 recordId);
    error DuplicateRecord(bytes32 dedupeKey);
    error CannotDisputeADispute();
    error EmptyBatch();
    error AdminRenounced();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event RecordAppended(
        uint256 indexed recordId,
        bytes32 indexed node,
        address indexed actor,
        Kind kind,
        Verdict verdict,
        address ownerAtIssue,
        bytes32 standardHash,
        bytes32 evidenceHash,
        uint256 refRecordId,
        bytes32 digest
    );
    event BatchAnchored(uint256 indexed batchId, address indexed actor, bytes32 root, uint32 count, string uri);
    event VerifierSet(address indexed verifier, bool allowed);
    event AdminUpdated(address indexed admin);
    event AdminRenouncedPermanently();

    /*//////////////////////////////////////////////////////////////
                               IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @dev The name registry this record set is bound to. Immutable: a record
    ///      about a name must always be resolvable against the same registry.
    INameOwner public immutable nameRegistry;
    uint256 public immutable boundChainId;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    address public admin;
    bool public adminRenounced;
    mapping(address => bool) public verifiers;

    Record[] private records;
    Batch[] private batches;
    /// @dev node => (pass, fail, unproven, disputes)
    mapping(bytes32 => uint32[4]) private counts;
    mapping(bytes32 => bool) private seenDigests;

    modifier onlyAdmin() {
        if (adminRenounced) revert AdminRenounced();
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyVerifier() {
        if (!verifiers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor(address nameRegistry_, address admin_) {
        if (nameRegistry_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        nameRegistry = INameOwner(nameRegistry_);
        admin = admin_;
        boundChainId = block.chainid;
        emit AdminUpdated(admin_);
    }

    /*//////////////////////////////////////////////////////////////
                            APPEND A VERDICT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Append one verdict about one name.
     * @param node ENS node of the subject, as the name registry computes it.
     * @param standardHash Hash of the criteria that were registered before the
     *        work started (ERC-8412 style). The verdict is meaningless without it.
     * @param evidenceHash Hash of the evidence the verifier inspected. The
     *        evidence itself stays off chain.
     * @param verdict Pass, Fail or Unproven.
     */
    function appendVerdict(
        bytes32 node,
        bytes32 standardHash,
        bytes32 evidenceHash,
        Verdict verdict
    ) external onlyVerifier returns (uint256 recordId) {
        if (uint8(verdict) > uint8(Verdict.Unproven)) revert InvalidVerdict(uint8(verdict));
        address ownerAtIssue = nameRegistry.owner(node);
        if (ownerAtIssue == address(0)) revert NotRegistered(node);

        recordId = _append(
            RecordInput({
                node: node,
                ownerAtIssue: ownerAtIssue,
                actor: msg.sender,
                verdict: verdict,
                kind: Kind.Verdict,
                standardHash: standardHash,
                evidenceHash: evidenceHash,
                refRecordId: 0
            })
        );
    }

    /**
     * @notice Dispute an existing verdict. Permissionless on purpose: anyone who
     *         believes a record is wrong may say so, and the disagreement is
     *         recorded rather than deleted.
     * @dev A dispute cannot target another dispute — the counter-claim is a new
     *      verdict from a verifier, not an argument in the log.
     */
    function raiseDispute(uint256 recordId, bytes32 evidenceHash) external returns (uint256 disputeId) {
        if (recordId >= records.length) revert UnknownRecord(recordId);
        Record storage target = records[recordId];
        if (target.kind != Kind.Verdict) revert CannotDisputeADispute();

        disputeId = _append(
            RecordInput({
                node: target.node,
                ownerAtIssue: target.ownerAtIssue,
                actor: msg.sender,
                verdict: Verdict.Unproven,
                kind: Kind.Dispute,
                standardHash: target.standardHash,
                evidenceHash: evidenceHash,
                refRecordId: recordId
            })
        );
    }

    function _append(RecordInput memory input) private returns (uint256 recordId) {
        uint64 issuedAt = uint64(block.timestamp);
        RecordDigest.Fields memory fields = _fields(input, issuedAt);
        bytes32 digest = RecordDigest.compute(fields);
        // Identical claims about the same owner are refused, so the counters
        // cannot be inflated by re-sending the same record. The owner is part of
        // the key on purpose: after a name changes hands, the same verdict about
        // the new owner is a different claim, and the old records must not be
        // inherited. A genuine re-verification changes the evidence hash, the
        // standard hash, or both.
        bytes32 dedupeKey = RecordDigest.dedupeKey(fields);
        if (seenDigests[dedupeKey]) revert DuplicateRecord(dedupeKey);
        seenDigests[dedupeKey] = true;

        records.push(
            Record({
                node: input.node,
                ownerAtIssue: input.ownerAtIssue,
                actor: input.actor,
                verdict: input.verdict,
                kind: input.kind,
                issuedAt: issuedAt,
                standardHash: input.standardHash,
                evidenceHash: input.evidenceHash,
                refRecordId: input.refRecordId,
                digest: digest
            })
        );
        recordId = records.length - 1;

        // Counters describe verdicts only. Disputes are counted separately, and
        // an Unproven verdict is never folded into a pass rate.
        if (input.kind == Kind.Verdict) counts[input.node][uint8(input.verdict)] += 1;
        else counts[input.node][3] += 1;

        emit RecordAppended(
            recordId,
            input.node,
            input.actor,
            input.kind,
            input.verdict,
            input.ownerAtIssue,
            input.standardHash,
            input.evidenceHash,
            input.refRecordId,
            digest
        );
    }

    function _fields(
        RecordInput memory input,
        uint64 issuedAt
    ) private view returns (RecordDigest.Fields memory) {
        return
            RecordDigest.Fields({
                chainId: boundChainId,
                registry: address(this),
                node: input.node,
                ownerAtIssue: input.ownerAtIssue,
                actor: input.actor,
                kind: uint8(input.kind),
                verdict: uint8(input.verdict),
                issuedAt: issuedAt,
                standardHash: input.standardHash,
                evidenceHash: input.evidenceHash,
                refRecordId: input.refRecordId
            });
    }

    /*//////////////////////////////////////////////////////////////
                                BATCHES
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Anchor a merkle root over record digests already stored here.
     * @dev Verifier-gated, because a root nobody signed is not evidence. The
     *      root is cheap; the records stay where they are.
     * @param uri Optional location of the full batch (empty string allowed).
     */
    function anchorBatch(
        bytes32 root,
        uint32 count,
        string calldata uri
    ) external onlyVerifier returns (uint256 batchId) {
        if (count == 0) revert EmptyBatch();
        batches.push(
            Batch({
                root: root,
                count: count,
                actor: msg.sender,
                anchoredAt: uint64(block.timestamp),
                uri: uri
            })
        );
        batchId = batches.length - 1;
        emit BatchAnchored(batchId, msg.sender, root, count, uri);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    function setVerifier(address verifier, bool allowed) external onlyAdmin {
        if (verifier == address(0)) revert ZeroAddress();
        verifiers[verifier] = allowed;
        emit VerifierSet(verifier, allowed);
    }

    /**
     * @notice Hand the verifier set to a multisig, ideally with an outside signer.
     * @dev Deliberately the only admin action that touches the admin slot, and
     *      deliberately not two-step: this contract holds no funds, so the worst
     *      case of a mistyped address is that the verifier set freezes. Freezing
     *      is safe here — records stay readable, and nothing can be fabricated.
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
        emit AdminUpdated(newAdmin);
    }

    /**
     * @notice Freeze the verifier set forever.
     * @dev The end state once the set is settled: after this, no new verifier can
     *      ever be added, so no new voice can be fabricated into the record.
     */
    function renounceAdmin() external onlyAdmin {
        adminRenounced = true;
        emit AdminRenouncedPermanently();
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function recordCount() external view returns (uint256) {
        return records.length;
    }

    function batchCount() external view returns (uint256) {
        return batches.length;
    }

    function getRecord(uint256 recordId) external view returns (Record memory) {
        if (recordId >= records.length) revert UnknownRecord(recordId);
        return records[recordId];
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        if (batchId >= batches.length) revert UnknownRecord(batchId);
        return batches[batchId];
    }

    /// @notice The facts a query should show, with the three outcomes kept apart.
    function summaryOf(
        bytes32 node
    ) external view returns (uint32 pass, uint32 fail, uint32 unproven, uint32 disputes) {
        uint32[4] storage entry = counts[node];
        return (entry[0], entry[1], entry[2], entry[3]);
    }

    /**
     * @notice Reproduce a record's digest from its fields.
     * @dev Mirrored byte for byte in `packages/core/src/record.ts`; a test in each
     *      language pins the same expected value, so an off-chain tool can rebuild
     *      a batch root without re-reading every log.
     */
    function computeDigest(
        bytes32 node,
        address ownerAtIssue,
        address actor,
        Verdict verdict,
        Kind kind,
        uint64 issuedAt,
        bytes32 standardHash,
        bytes32 evidenceHash,
        uint256 refRecordId
    ) public view returns (bytes32) {
        return
            RecordDigest.compute(
                RecordDigest.Fields({
                    chainId: boundChainId,
                    registry: address(this),
                    node: node,
                    ownerAtIssue: ownerAtIssue,
                    actor: actor,
                    kind: uint8(kind),
                    verdict: uint8(verdict),
                    issuedAt: issuedAt,
                    standardHash: standardHash,
                    evidenceHash: evidenceHash,
                    refRecordId: refRecordId
                })
            );
    }
}
