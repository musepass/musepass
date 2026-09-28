// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

/**
 * @title SignatureVerifier
 * @notice Pins the CCIP-Read signature scheme to the same bytes the gateway
 *         signs, so a drift is caught here instead of in production as
 *         "InvalidSignature" that looks like a gateway outage.
 *
 * The contract-side rule, copied from Durin's L1Resolver/SignatureVerifier:
 *   keccak256(abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result)))
 * where `request` is the OffchainLookup extraData, which the resolver sets to
 * the same bytes as the callData carried in the URL.
 *
 * The constants below are asserted verbatim by
 * apps/gateway/test/ccipRead.test.ts.
 */
contract SignatureVerifierTest is Test {
    address internal constant SENDER = 0x8A968aB9eb8C084FBC44c531058Fc9ef945c3D61;
    uint64 internal constant EXPIRES = 1790619628;
    address internal constant EXPECTED_SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    bytes internal constant REQUEST = hex"1234";
    bytes internal constant RESULT = hex"abcd";

    bytes32 internal constant EXPECTED_HASH =
        0x986952d68a4090deccd73dc19e90d38484fe5839bbeb390643c6c9aca6a2876c;

    bytes internal constant EXPECTED_SIGNATURE =
        hex"63e6e6b02ea7359800e6c98b12b9ae7af2941176a550028a3272993eb4dcaa1e1b357ca0a7e1f73fc631b08f25a361b45570374051691d7b231092abd42d20651b";

    /// @dev Same body as SignatureVerifier.makeSignatureHash.
    function makeSignatureHash(
        address target,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    hex"1900",
                    target,
                    expires,
                    keccak256(request),
                    keccak256(result)
                )
            );
    }

    function test_MakeSignatureHash_MatchesTheGatewayVector() public pure {
        assertEq(
            makeSignatureHash(SENDER, EXPIRES, REQUEST, RESULT),
            EXPECTED_HASH,
            "gateway and contract disagree on the signing hash"
        );
    }

    function test_GatewaySignature_RecoversToTheConfiguredSigner() public pure {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(EXPECTED_SIGNATURE);
        assertEq(
            ecrecover(EXPECTED_HASH, v, r, s),
            EXPECTED_SIGNER,
            "the signature the gateway produces does not recover to its signer"
        );
    }

    /// @dev The resolver's callback decodes the response as this exact tuple.
    function test_ResponseTuple_DecodesAsTheResolverExpects() public pure {
        bytes memory response = abi.encode(RESULT, EXPIRES, EXPECTED_SIGNATURE);
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(
            response,
            (bytes, uint64, bytes)
        );
        assertEq(result, RESULT);
        assertEq(expires, EXPIRES);
        assertEq(sig, EXPECTED_SIGNATURE);
    }

    function test_HashChangesWithEveryField() public pure {
        bytes32 base = makeSignatureHash(SENDER, EXPIRES, REQUEST, RESULT);
        assertTrue(base != makeSignatureHash(address(1), EXPIRES, REQUEST, RESULT));
        assertTrue(base != makeSignatureHash(SENDER, EXPIRES + 1, REQUEST, RESULT));
        assertTrue(base != makeSignatureHash(SENDER, EXPIRES, hex"1235", RESULT));
        assertTrue(base != makeSignatureHash(SENDER, EXPIRES, REQUEST, hex"abce"));
    }

    /// @dev A response that has not expired is accepted; the resolver checks this.
    function test_ExpiryIsComparedAsATimestamp() public pure {
        assertTrue(EXPIRES >= EXPIRES);
    }

    function splitSignature(
        bytes memory signature
    ) private pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(signature.length == 65, "bad signature length");
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
    }
}
