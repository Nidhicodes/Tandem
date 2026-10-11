// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title TandemVault
/// @notice Each account stores one opaque blob: its settings, AES-GCM encrypted under a key
/// derived from the user's passkey. Ciphertext only -- the contract never sees a key, so a
/// public read is harmless. The same passkey on any device re-derives the key and decrypts.
contract TandemVault {
    uint256 public constant MAX_BYTES = 4096;

    mapping(address => bytes) private blobs;

    event Saved(address indexed owner, uint256 size);

    error TooLarge();

    function save(bytes calldata blob) external {
        if (blob.length > MAX_BYTES) revert TooLarge();
        blobs[msg.sender] = blob;
        emit Saved(msg.sender, blob.length);
    }

    function load(address owner) external view returns (bytes memory) {
        return blobs[owner];
    }
}
