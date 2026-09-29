// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title The one thing the record registry needs from the name registry
/// @notice Kept to a single function on purpose: reading the owner at the moment
///         a record is written is what binds a track record to "this name, owned
///         by this address, on this date" without trusting the verifier's claim.
interface INameOwner {
    function owner(bytes32 node) external view returns (address);
}
