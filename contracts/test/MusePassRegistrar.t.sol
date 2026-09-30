// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {MusePassRegistrar} from "../src/MusePassRegistrar.sol";
import {IL2Registry} from "../src/interfaces/IL2Registry.sol";

/// @dev Mirrors the parts of Durin's L2Registry this contract touches, including
///      its access rules, so the tests exercise the real authorisation shape.
contract MockL2Registry is IL2Registry {
    bytes32 public override baseNode;
    mapping(bytes32 => address) internal _owners;
    mapping(address => bool) public override registrars;
    mapping(bytes32 => mapping(uint256 => bytes)) internal _addrRecords;

    constructor(bytes32 baseNode_) {
        baseNode = baseNode_;
    }

    function addRegistrar(address registrar) external {
        registrars[registrar] = true;
    }

    function makeNode(
        bytes32 parentNode,
        string calldata label
    ) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }

    function owner(bytes32 node) external view override returns (address) {
        return _owners[node];
    }

    function createSubnode(
        bytes32 node,
        string calldata label,
        address owner_,
        bytes[] calldata
    ) external override returns (bytes32) {
        require(registrars[msg.sender], "MockL2Registry: not a registrar");
        bytes32 subnode = keccak256(abi.encodePacked(node, keccak256(bytes(label))));
        require(_owners[subnode] == address(0), "MockL2Registry: taken");
        _owners[subnode] = owner_;
        return subnode;
    }

    /// @dev Same rule as Durin's L2Resolver.isAuthorisedForAddress: a registrar
    ///      may write records for any node, the node owner may write its own.
    function setAddr(bytes32 node, uint256 coinType, bytes calldata a) external override {
        require(
            registrars[msg.sender] || _owners[node] == msg.sender,
            "MockL2Registry: unauthorized"
        );
        _addrRecords[node][coinType] = a;
    }

    /// @dev Same getter as the real registry, which is an ENS resolver.
    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        return _addrRecords[node][coinType];
    }
}

contract MusePassRegistrarTest is Test {
    bytes32 internal constant ETH_NODE =
        0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint256 internal constant BENEFICIARY_PK = 0xA11CE;
    uint256 internal constant STRANGER_PK = 0xB0B;

    MockL2Registry internal registry;
    MusePassRegistrar internal registrar;

    address internal beneficiary;
    address internal stranger;
    bytes32 internal baseNode;
    uint256 internal deadline;

    function setUp() public {
        // namehash("musepass.eth") built the same way ENS does it.
        baseNode = keccak256(abi.encodePacked(ETH_NODE, keccak256(bytes("musename"))));

        registry = new MockL2Registry(baseNode);
        registrar = new MusePassRegistrar(
            address(registry),
            "MusePass",
            "1",
            address(this),
            3 // mirror the shortest on chain label we will ever issue until phase 6
        );
        registry.addRegistrar(address(registrar));
        registrar.setRelayer(address(this), true);

        beneficiary = vm.addr(BENEFICIARY_PK);
        stranger = vm.addr(STRANGER_PK);
        deadline = block.timestamp + 15 minutes;
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _sign(uint256 privateKey, string memory label, address owner_, uint256 deadline_)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registrar.hashRegister(label, owner_, deadline_);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /*//////////////////////////////////////////////////////////////
                              HAPPY PATHS
    //////////////////////////////////////////////////////////////*/

    function test_Register_MintsNameToBeneficiary() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);

        bytes32 node = registrar.register("aguang", beneficiary, deadline, signature);

        assertEq(registry.owner(node), beneficiary, "name must belong to the signer");
        assertEq(node, keccak256(abi.encodePacked(baseNode, keccak256(bytes("aguang")))));
    }

    function test_Register_SetsAddressRecordsForThisChainAndMainnet() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);
        bytes32 node = registrar.register("aguang", beneficiary, deadline, signature);

        uint256 expectedCoinType = uint256(0x80000000) | block.chainid;
        assertEq(registry.addr(node, expectedCoinType), abi.encodePacked(beneficiary));
        assertEq(registry.addr(node, 60), abi.encodePacked(beneficiary));
    }

    function test_Register_EmitsEvent() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);
        bytes32 node = keccak256(abi.encodePacked(baseNode, keccak256(bytes("aguang"))));

        vm.expectEmit(true, true, false, true, address(registrar));
        emit MusePassRegistrar.NameRegistered(node, "aguang", beneficiary);
        registrar.register("aguang", beneficiary, deadline, signature);
    }

    function test_IsAvailable_ReflectsChainState() public {
        assertTrue(registrar.isAvailable("aguang"));
        assertFalse(registrar.isAvailable("ab"), "shorter than minLabelBytes");

        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);
        registrar.register("aguang", beneficiary, deadline, signature);
        assertFalse(registrar.isAvailable("aguang"));
    }

    /*//////////////////////////////////////////////////////////////
                          LABEL SHAPE ON CHAIN
    //////////////////////////////////////////////////////////////*/

    /// The API normalises, but a stolen issuing key talks to the contract
    /// directly. These are the shapes it must still refuse.
    function test_Register_RevertsForUppercaseAscii() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "Aguang", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 0, bytes1("A"))
        );
        registrar.register("Aguang", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForAnEmbeddedDot() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "a.b", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 1, bytes1("."))
        );
        registrar.register("a.b", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForNonAsciiPunctuation() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "a_b", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 1, bytes1("_"))
        );
        registrar.register("a_b", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForAZeroWidthJoiner() public {
        // U+200D zero-width joiner: two visually identical labels.
        bytes memory signature = _sign(BENEFICIARY_PK, unicode"a\u200Db", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 1, bytes1(0xE2))
        );
        registrar.register(unicode"a\u200Db", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForABidiOverride() public {
        // U+202E right-to-left override, the classic filename-spoofing byte.
        bytes memory signature = _sign(BENEFICIARY_PK, unicode"a\u202Eb", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 1, bytes1(0xE2))
        );
        registrar.register(unicode"a\u202Eb", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForALeadingHyphen() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "-aguang", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 0, bytes1("-"))
        );
        registrar.register("-aguang", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForATrailingHyphen() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang-", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelInvalidCharacter.selector, 6, bytes1("-"))
        );
        registrar.register("aguang-", beneficiary, deadline, signature);
    }

    /// Chinese labels are a supported product feature, so the on-chain check
    /// must not touch non-ASCII letters. Mixed-script detection is the API's job.
    function test_Register_StillAllowsChineseLabels() public {
        string memory label = unicode"阿光摄影";
        bytes memory signature = _sign(BENEFICIARY_PK, label, beneficiary, deadline);

        bytes32 node = registrar.register(label, beneficiary, deadline, signature);
        assertEq(registry.owner(node), beneficiary);
    }

    function test_Register_AllowsAnInteriorHyphen() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "a-guang", beneficiary, deadline);

        bytes32 node = registrar.register("a-guang", beneficiary, deadline, signature);
        assertEq(registry.owner(node), beneficiary);
    }

    function test_IsAvailable_SaysNoToAnInvalidShape() public {
        assertFalse(registrar.isAvailable("Aguang"));
        assertFalse(registrar.isAvailable("a.b"));
        assertFalse(registrar.isAvailable("-aguang"));
        assertTrue(registrar.isAvailable("a-guang"));
    }

    /*//////////////////////////////////////////////////////////////
                            SIGNATURE RULES
    //////////////////////////////////////////////////////////////*/

    function test_Register_RevertsWhenSignatureIsFromAnotherKey() public {
        bytes memory signature = _sign(STRANGER_PK, "aguang", beneficiary, deadline);

        vm.expectRevert(MusePassRegistrar.InvalidSignature.selector);
        registrar.register("aguang", beneficiary, deadline, signature);
    }

    function test_Register_RevertsWhenLabelWasSwappedAfterSigning() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);

        vm.expectRevert(MusePassRegistrar.InvalidSignature.selector);
        registrar.register("someoneelse", beneficiary, deadline, signature);
    }

    function test_Register_RevertsWhenBeneficiaryWasSwappedAfterSigning() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);

        vm.expectRevert(MusePassRegistrar.InvalidSignature.selector);
        registrar.register("aguang", stranger, deadline, signature);
    }

    function test_Register_RevertsAfterDeadline() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);

        vm.warp(deadline + 1);

        vm.expectRevert(MusePassRegistrar.SignatureExpired.selector);
        registrar.register("aguang", beneficiary, deadline, signature);
    }

    function test_Register_RevertsOnMalleableSignature() public {
        bytes32 digest = registrar.hashRegister("aguang", beneficiary, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BENEFICIARY_PK, digest);

        // Flip s to the other valid value for the same signature and swap v.
        bytes32 flipped = bytes32(
            0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - uint256(s)
        );
        uint8 flippedV = v == 27 ? 28 : 27;

        vm.expectRevert(MusePassRegistrar.InvalidSignature.selector);
        registrar.register("aguang", beneficiary, deadline, abi.encodePacked(r, flipped, flippedV));
    }

    /*//////////////////////////////////////////////////////////////
                            POLICY ENFORCEMENT
    //////////////////////////////////////////////////////////////*/

    function test_Register_RevertsForReservedLabel() public {
        registrar.setReserved(_hashes("admin"), true);
        bytes memory signature = _sign(BENEFICIARY_PK, "admin", beneficiary, deadline);

        vm.expectRevert(
            abi.encodeWithSelector(MusePassRegistrar.LabelReserved.selector, keccak256(bytes("admin")))
        );
        registrar.register("admin", beneficiary, deadline, signature);
    }

    function test_Register_AllowsALabelAfterItIsUnreserved() public {
        registrar.setReserved(_hashes("admin"), true);
        registrar.setReserved(_hashes("admin"), false);

        bytes memory signature = _sign(BENEFICIARY_PK, "admin", beneficiary, deadline);
        bytes32 node = registrar.register("admin", beneficiary, deadline, signature);
        assertEq(registry.owner(node), beneficiary);
    }

    function test_Register_RevertsBelowMinimumLabelLength() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "ab", beneficiary, deadline);

        vm.expectRevert(MusePassRegistrar.LabelTooShort.selector);
        registrar.register("ab", beneficiary, deadline, signature);
    }

    function test_Register_RevertsForZeroBeneficiary() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", address(0), deadline);

        vm.expectRevert(MusePassRegistrar.ZeroAddress.selector);
        registrar.register("aguang", address(0), deadline, signature);
    }

    function test_Register_RevertsWhenNameIsAlreadyOwned() public {
        bytes memory first = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);
        registrar.register("aguang", beneficiary, deadline, first);

        bytes memory second = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);
        bytes32 node = keccak256(abi.encodePacked(baseNode, keccak256(bytes("aguang"))));

        vm.expectRevert(abi.encodeWithSelector(MusePassRegistrar.NameUnavailable.selector, node));
        registrar.register("aguang", beneficiary, deadline, second);
    }

    /*//////////////////////////////////////////////////////////////
                            ACCESS CONTROL
    //////////////////////////////////////////////////////////////*/

    function test_Register_RevertsForNonRelayerWhileRestricted() public {
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);

        vm.prank(stranger);
        vm.expectRevert(MusePassRegistrar.Unauthorized.selector);
        registrar.register("aguang", beneficiary, deadline, signature);
    }

    function test_Register_AllowsAnyoneWhenUnrestricted() public {
        registrar.setRelayerRestricted(false);
        bytes memory signature = _sign(BENEFICIARY_PK, "aguang", beneficiary, deadline);

        vm.prank(stranger);
        bytes32 node = registrar.register("aguang", beneficiary, deadline, signature);

        assertEq(registry.owner(node), beneficiary, "caller never becomes the owner");
    }

    function test_AdminFunctions_AreOwnerOnly() public {
        vm.startPrank(stranger);

        vm.expectRevert(MusePassRegistrar.Unauthorized.selector);
        registrar.setRelayer(stranger, true);

        vm.expectRevert(MusePassRegistrar.Unauthorized.selector);
        registrar.setMinLabelBytes(1);

        vm.expectRevert(MusePassRegistrar.Unauthorized.selector);
        registrar.setReserved(_hashes("admin"), true);

        vm.expectRevert(MusePassRegistrar.Unauthorized.selector);
        registrar.setRelayerRestricted(false);

        vm.expectRevert(MusePassRegistrar.Unauthorized.selector);
        registrar.transferOwnership(stranger);
        vm.stopPrank();
    }

    /// The platform's hot key is only a gas payer: it holds no registry rights
    /// and therefore cannot touch a name that a user already owns.
    function test_PlatformKey_HasNoRegistryRights() public view {
        assertFalse(registry.registrars(address(this)), "the EOA must not be a registrar");
        assertTrue(registry.registrars(address(registrar)), "only the contract is a registrar");
    }

    /*//////////////////////////////////////////////////////////////
                          OFF CHAIN AGREEMENT
    //////////////////////////////////////////////////////////////*/

    function test_MakeNode_MatchesTheCanonicalEthNode() public view {
        assertEq(
            registry.makeNode(bytes32(0), "eth"),
            ETH_NODE,
            "the L2 construction must agree with ENS namehash"
        );
    }

    function test_DomainSeparator_UsesTheConfiguredBrand() public view {
        bytes32 expected = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("MusePass")),
                keccak256(bytes("1")),
                block.chainid,
                address(registrar)
            )
        );
        assertEq(registrar.domainSeparator(), expected);
    }

    function test_Constructor_SetsChainCoinType() public view {
        assertEq(registrar.chainCoinType(), uint256(0x80000000) | block.chainid);
    }

    function test_Constructor_RejectsZeroRegistry() public {
        vm.expectRevert(MusePassRegistrar.ZeroAddress.selector);
        new MusePassRegistrar(address(0), "MusePass", "1", address(this), 3);
    }

    function test_Constructor_RejectsTooPermissiveMinimum() public {
        vm.expectRevert(MusePassRegistrar.LabelTooShort.selector);
        new MusePassRegistrar(address(registry), "MusePass", "1", address(this), 0);
    }

    /*//////////////////////////////////////////////////////////////
                                UTILS
    //////////////////////////////////////////////////////////////*/

    function _hashes(string memory label) internal pure returns (bytes32[] memory hashes) {
        hashes = new bytes32[](1);
        hashes[0] = keccak256(bytes(label));
    }
}
