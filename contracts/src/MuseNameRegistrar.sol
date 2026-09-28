// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IL2Registry} from "./interfaces/IL2Registry.sol";

/**
 * @title MuseNameRegistrar
 * @notice Issues MuseName subnames on a Durin L2 registry using a signature
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
contract MuseNameRegistrar {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error Unauthorized();
    error ZeroAddress();
    error LabelTooShort();
    error LabelTooLong();
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
