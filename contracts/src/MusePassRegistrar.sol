// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IL2Registry} from "./interfaces/IL2Registry.sol";

/**
 * @title MusePassRegistrar
 * @notice Issues MusePass subnames on a Durin L2 registry using a signature
 *         that the future owner produced off chain.
 *
 * Design notes, because the trust story is the product:
 *
 * 1. This contract - not a platform hot key - is the registry's registrar. The
 *    sponsoring key can only pay gas for calls to `register`, so a stolen key
 *    cannot rewrite or transfer a name that a user already owns.
 * 2. A name can only be created for an address whose owner signed for exactly
 *    that label. A captured signature is therefore useless: replaying it can
 *    only ever mint the same name to the same owner, and the name can only be
 *    minted once.
 * 3. Ownership goes to `beneficiary` directly. The registry has no burn and no
 *    admin transfer, so the platform cannot take a name back.
 * 4. Reserved labels and the minimum label length are enforced here rather than
 *    only in the API, so calling the contract directly cannot bypass them.
 *
 * This contract holds no funds. It must still be reviewed externally before any
 * paid tier (phase 6) is allowed to depend on it.
 */
contract MusePassRegistrar {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error Unauthorized();
    error ZeroAddress();
    error LabelTooShort();
    error LabelTooLong();
    error LabelInvalidCharacter(uint256 index, bytes1 character);
    error LabelReserved(bytes32 labelHash);
    error NameUnavailable(bytes32 node);
    error SignatureExpired();
    error InvalidSignature();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event NameRegistered(bytes32 indexed node, string label, address indexed owner);
    event RelayerUpdated(address indexed relayer, bool allowed);
    event RelayerRestrictionUpdated(bool restricted);
    event ReservedUpdated(bytes32 indexed labelHash, bool reserved);
    event MinLabelBytesUpdated(uint256 minLabelBytes);
    event OwnerUpdated(address indexed owner);

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    bytes32 private constant REGISTER_TYPEHASH =
        keccak256("Register(string label,address owner,uint256 deadline)");

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev secp256k1 group order / 2, to reject malleable signatures.
    uint256 private constant SIG_S_LIMIT =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    uint256 private constant MAX_LABEL_BYTES = 255;

    /*//////////////////////////////////////////////////////////////
                              IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    IL2Registry public immutable registry;
    bytes32 public immutable baseNode;
    /// @dev ENSIP-11 coin type for this chain: 0x80000000 | block.chainid
    uint256 public immutable chainCoinType;

    /*//////////////////////////////////////////////////////////////
                            EIP-712 DOMAIN
    //////////////////////////////////////////////////////////////*/

    /// @dev Comes from config/brand.json, set once at deploy so a rename is a redeploy.
    string public name;
    string public version;

    /*//////////////////////////////////////////////////////////////
                               STORAGE
    //////////////////////////////////////////////////////////////*/

    address public owner;
    uint256 public minLabelBytes;
    bool public relayerRestricted;
    mapping(address => bool) public relayers;
    mapping(bytes32 => bool) public reservedLabels;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address registry_,
        string memory name_,
        string memory version_,
        address owner_,
        uint256 minLabelBytes_
    ) {
        if (registry_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (minLabelBytes_ == 0 || minLabelBytes_ > MAX_LABEL_BYTES) revert LabelTooShort();

        registry = IL2Registry(registry_);
        baseNode = IL2Registry(registry_).baseNode();
        chainCoinType = uint256(0x80000000) | block.chainid;
        name = name_;
        version = version_;
        owner = owner_;
        minLabelBytes = minLabelBytes_;
        // Sponsorship is gated by default: the platform pays, so the platform decides who may ask.
        relayerRestricted = true;
    }

    /*//////////////////////////////////////////////////////////////
                              REGISTRATION
    //////////////////////////////////////////////////////////////*/

    function isAvailable(string calldata label) external view returns (bool) {
        bytes memory labelBytes = bytes(label);
        if (labelBytes.length < minLabelBytes) return false;
        if (labelBytes.length > MAX_LABEL_BYTES) return false;
        if (_firstInvalidByte(labelBytes) != type(uint256).max) return false;
        if (reservedLabels[keccak256(labelBytes)]) return false;
        return registry.owner(registry.makeNode(baseNode, label)) == address(0);
    }

    /**
     * @param label ENSIP-15 normalized label, without the root name.
     * @param beneficiary Address that will own the name. Must be the signer.
     * @param deadline Unix timestamp after which the signature is void.
     * @param signature EIP-712 signature over Register(label, beneficiary, deadline).
     */
    function register(
        string calldata label,
        address beneficiary,
        uint256 deadline,
        bytes calldata signature
    ) external returns (bytes32 node) {
        if (relayerRestricted && !relayers[msg.sender]) revert Unauthorized();
        if (beneficiary == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes memory labelBytes = bytes(label);
        if (labelBytes.length < minLabelBytes) revert LabelTooShort();
        if (labelBytes.length > MAX_LABEL_BYTES) revert LabelTooLong();
        uint256 invalidIndex = _firstInvalidByte(labelBytes);
        if (invalidIndex != type(uint256).max) {
            revert LabelInvalidCharacter(invalidIndex, labelBytes[invalidIndex]);
        }

        bytes32 labelHash = keccak256(labelBytes);
        if (reservedLabels[labelHash]) revert LabelReserved(labelHash);

        node = registry.makeNode(baseNode, label);
        if (registry.owner(node) != address(0)) revert NameUnavailable(node);

        _verifySignature(beneficiary, hashRegister(label, beneficiary, deadline), signature);

        // Forward resolution on this chain plus mainnet, matching Durin's
        // registrar template. Both records point at the owner.
        bytes memory encodedAddress = abi.encodePacked(beneficiary);
        registry.setAddr(node, chainCoinType, encodedAddress);
        registry.setAddr(node, 60, encodedAddress);

        registry.createSubnode(baseNode, label, beneficiary, new bytes[](0));

        emit NameRegistered(node, label, beneficiary);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function setRelayerRestricted(bool restricted) external onlyOwner {
        relayerRestricted = restricted;
        emit RelayerRestrictionUpdated(restricted);
    }

    function setMinLabelBytes(uint256 newMin) external onlyOwner {
        if (newMin == 0 || newMin > MAX_LABEL_BYTES) revert LabelTooShort();
        minLabelBytes = newMin;
        emit MinLabelBytesUpdated(newMin);
    }

    /// @notice Batch mirror of the off-chain reserved list. No membership proof
    ///         shapes are needed because every entry is a fixed-size hash.
    function setReserved(bytes32[] calldata labelHashes, bool reserved) external onlyOwner {
        for (uint256 i = 0; i < labelHashes.length; ++i) {
            reservedLabels[labelHashes[i]] = reserved;
            emit ReservedUpdated(labelHashes[i], reserved);
        }
    }

    /*//////////////////////////////////////////////////////////////
                            EIP-712 HELPERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice The last line of defence for the shape of a label.
     *
     * An outside review (2026-09-29) pointed out that the character set was
     * only enforced in the API, so a stolen issuing key could bypass it and mint
     * labels the product would never show: uppercase ASCII, embedded dots, and
     * invisible characters. This checks the cases that matter and can be checked
     * on chain without a Unicode table:
     *
     *   - ASCII must be lowercase a-z, digit 0-9, or hyphen. Everything else —
     *     uppercase, dot, slash, colon, at-sign, control bytes, underscore — is
     *     refused.
     *   - A hyphen may not be the first or last byte (config/limits.json
     *     `disallowEdgeHyphen`, and an edge hyphen reads as a spoof).
     *   - Zero-width and bidirectional control characters are refused: they are
     *     how two different names are made to look identical.
     *
     * Deliberately *not* here: full ENSIP-15 normalization, mixed-script and
     * confusable detection. Those need Unicode tables and stay in
     * `packages/core` (`normalizeLabel`, `checkScriptMixing`); this function
     * only closes the hole that a bypass of that layer would open.
     *
     * @return index `type(uint256).max` when the label is acceptable.
     */
    function _firstInvalidByte(bytes memory labelBytes) private pure returns (uint256 index) {
        uint256 length = labelBytes.length;
        for (uint256 i = 0; i < length; ++i) {
            bytes1 character = labelBytes[i];
            uint8 value = uint8(character);
            if (value < 0x80) {
                bool allowed = (value >= 0x61 && value <= 0x7a) ||
                    (value >= 0x30 && value <= 0x39) ||
                    value == 0x2d;
                if (!allowed) return i;
                if (value == 0x2d && (i == 0 || i == length - 1)) return i;
                continue;
            }
            if (_isInvisibleSequence(labelBytes, i)) return i;
        }
        return type(uint256).max;
    }

    /// @dev Zero-width joiners, soft hyphen, bidi overrides and the BOM, by
    ///      their UTF-8 prefix. Matching the prefix is enough: the whole
    ///      sequence is refused either way.
    function _isInvisibleSequence(
        bytes memory labelBytes,
        uint256 i
    ) private pure returns (bool) {
        bytes1 first = labelBytes[i];
        if (first == 0xC2 && i + 1 < labelBytes.length && labelBytes[i + 1] == 0xAD) return true;
        if (first == 0xEF && i + 2 < labelBytes.length) {
            return labelBytes[i + 1] == 0xBB && labelBytes[i + 2] == 0xBF;
        }
        if (first != 0xE2 || i + 2 >= labelBytes.length) return false;
        bytes1 second = labelBytes[i + 1];
        bytes1 third = labelBytes[i + 2];
        if (second == 0x80) {
            // U+200B..U+200F and U+202A..U+202E
            return (third >= 0x8B && third <= 0x8F) || (third >= 0xAA && third <= 0xAE);
        }
        if (second == 0x81) {
            // U+2060..U+2069: word joiner and the bidi isolates
            return third >= 0xA0 && third <= 0xA9;
        }
        return false;
    }

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes(name)),
                    keccak256(bytes(version)),
                    block.chainid,
                    address(this)
                )
            );
    }

    /// @dev Must equal viem's `hashTypedData` for the same message; a test
    ///      asserts the two agree byte for byte.
    function hashRegister(
        string calldata label,
        address beneficiary,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(REGISTER_TYPEHASH, keccak256(bytes(label)), beneficiary, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _verifySignature(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) private view {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 32))
                v := byte(0, calldataload(add(signature.offset, 64)))
            }
            if (v < 27) v += 27;
            if (v == 27 || v == 28) {
                if (uint256(s) <= SIG_S_LIMIT) {
                    address recovered = ecrecover(digest, v, r, s);
                    if (recovered != address(0) && recovered == signer) return;
                }
            }
        }

        // ERC-1271 fallback for smart contract wallets (Safe and friends).
        if (signer.code.length > 0) {
            (bool ok, bytes memory result) = signer.staticcall(
                abi.encodeWithSelector(0x1626ba7e, digest, signature)
            );
            if (ok && result.length >= 32 && abi.decode(result, (bytes4)) == bytes4(0x1626ba7e)) {
                return;
            }
        }

        revert InvalidSignature();
    }
}
