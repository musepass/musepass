// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Subset of Durin's IL2Registry
/// @notice Vendored interface so this repo never depends on a moving upstream
///         file to compile. Field order and signatures match
///         https://github.com/ensdomains/durin/blob/main/src/interfaces/IL2Registry.sol
interface IL2Registry {
    function baseNode() external view returns (bytes32);

    function makeNode(bytes32 parentNode, string calldata label) external pure returns (bytes32);

    function owner(bytes32 node) external view returns (address);

    function registrars(address registrar) external view returns (bool);

    function createSubnode(
        bytes32 node,
        string calldata label,
        address owner,
        bytes[] calldata data
    ) external returns (bytes32);

    function setAddr(bytes32 node, uint256 coinType, bytes calldata a) external;
}
