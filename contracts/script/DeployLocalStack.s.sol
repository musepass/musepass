// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {MuseNameRegistrar} from "../src/MuseNameRegistrar.sol";
import {LocalL2Registry} from "./mocks/LocalL2Registry.sol";

/**
 * Local end-to-end stack: a local registry plus the real registrar.
 *
 * Used to prove that the digest the contract accepts (EIP-712, computed in
 * Solidity) is byte-for-byte the digest packages/core computes with viem, and
 * that a signature produced off chain is accepted on chain.
 *
 *   anvil
 *   forge script script/DeployLocalStack.s.sol \
 *     --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract DeployLocalStack is Script {
    bytes32 internal constant ETH_NODE =
        0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;

    function run() external returns (address registryAddress, address registrarAddress) {
        uint256 deployerKey = vm.envOr(
            "MUSENAME_DEPLOYER_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address admin = vm.envOr("MUSENAME_REGISTRAR_OWNER", msg.sender);

        bytes32 baseNode = keccak256(abi.encodePacked(ETH_NODE, keccak256(bytes("musename"))));

        vm.startBroadcast(deployerKey);
        LocalL2Registry registry = new LocalL2Registry(baseNode);
        MuseNameRegistrar registrar =
            new MuseNameRegistrar(address(registry), "MuseName", "1", admin, 3);
        registry.addRegistrar(address(registrar));
        registrar.setRelayer(admin, true);
        vm.stopBroadcast();

        console2.log("LocalL2Registry", address(registry));
        console2.log("MuseNameRegistrar", address(registrar));
        console2.log("baseNode");
        console2.logBytes32(baseNode);

        return (address(registry), address(registrar));
    }
}
