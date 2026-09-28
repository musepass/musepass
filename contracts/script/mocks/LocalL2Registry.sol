// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IL2Registry} from "../../src/interfaces/IL2Registry.sol";

/**
 * @title LocalL2Registry
 * @notice Local-only stand-in for Durin's L2Registry, used by the local stack
 *         script so the off-chain/on-chain signature agreement can be checked
 *         without spending testnet funds.
 *
 * Not part of any deployment. Never deploy this outside a local node; it has no
 * real access control on `createSubnode`.
 */
contract LocalL2Registry is IL2Registry {
    bytes32 public override baseNode;
    mapping(bytes32 => address) internal _owners;
    mapping(address => bool) public override registrars;
    mapping(bytes32 => mapping(uint256 => bytes)) public addrRecords;

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
        require(registrars[msg.sender], "LocalL2Registry: not a registrar");
        bytes32 subnode = keccak256(abi.encodePacked(node, keccak256(bytes(label))));
        require(_owners[subnode] == address(0), "LocalL2Registry: taken");
        _owners[subnode] = owner_;
        return subnode;
    }

    function setAddr(bytes32 node, uint256 coinType, bytes calldata a) external override {
        require(
            registrars[msg.sender] || _owners[node] == msg.sender,
            "LocalL2Registry: unauthorized"
        );
        addrRecords[node][coinType] = a;
    }
}
