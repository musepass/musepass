// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {MusePassRegistrar} from "../src/MusePassRegistrar.sol";

/**
 * Deploys the only contract MusePass writes.
 *
 * Required env:
 *   MUSENAME_L2_REGISTRY      Durin L2Registry (already deployed via durin.dev)
 *   MUSENAME_BRAND_NAME       EIP-712 domain name, from config/brand.json
 *   MUSENAME_MIN_LABEL_BYTES  byte length floor, from config/limits.json
 *   MUSENAME_REGISTRAR_OWNER  multisig / hardware wallet that administers it
 *
 * The deployer key is a throwaway use-and-discard key. Ownership of the
 * contract goes to MUSENAME_REGISTRAR_OWNER, never to the deployer.
 */
contract DeployMusePassRegistrar is Script {
    function run() external returns (address) {
        address registry = vm.envAddress("MUSENAME_L2_REGISTRY");
        string memory brandName = vm.envString("MUSENAME_BRAND_NAME");
        uint256 minLabelBytes = vm.envUint("MUSENAME_MIN_LABEL_BYTES");
        address owner = vm.envAddress("MUSENAME_REGISTRAR_OWNER");
        uint256 deployerKey = vm.envUint("MUSENAME_DEPLOYER_KEY");

        vm.startBroadcast(deployerKey);
        MusePassRegistrar registrar =
            new MusePassRegistrar(registry, brandName, "1", owner, minLabelBytes);
        vm.stopBroadcast();

        console2.log("MusePassRegistrar deployed at", address(registrar));
        console2.log("registry (L2)", registry);
        console2.log("owner", owner);
        console2.log("minLabelBytes", minLabelBytes);
        console2.log("");
        console2.log("Next steps, both done from the registry admin:");
        console2.log("  1. L2Registry.addRegistrar(registrar)");
        console2.log("  2. registrar.setRelayer(<issuer key address>, true)");

        return address(registrar);
    }
}
