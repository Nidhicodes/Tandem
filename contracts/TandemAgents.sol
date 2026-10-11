// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @title TandemAgents
/// @notice Registry of always-on copy agents. A follower registers who they copy and their
/// risk rules (public), plus their trade-only Perpl agent key sealed to the Tandem engine's
/// X25519 public key (ciphertext only). The Chainlink CRE workflow reads this registry to
/// decide when a follower has drifted from its leader; the engine reads it to act.
/// The agent key can place Perpl orders but can never withdraw (Perpl API design).
contract TandemAgents {
    struct Agent {
        uint64 follower; // follower's Perpl exchange account id
        uint64 leader; // leader's Perpl exchange account id
        uint32 ratioBps; // follower size as a share of the leader's, 10000 = 100%
        uint32 maxNotional; // per-market cap, whole AUSD
        uint16 leverage; // whole x
        uint32 maxLoss; // flatten and halt below -maxLoss AUSD of open PnL
        bool halted; // set by the operator when maxLoss is hit; cleared by start()
    }

    uint256 public constant MAX_SEALED_BYTES = 512;
    address public immutable operator;

    mapping(address => Agent) public agents;
    mapping(address => bytes) public sealedKeys;
    address[] private owners;
    mapping(address => uint256) private slot; // 1-based index into owners

    event Started(address indexed owner, uint64 follower, uint64 leader);
    event Stopped(address indexed owner);
    event Halted(address indexed owner, string reason);

    error TooLarge();
    error NotOperator();
    error NotActive();

    constructor(address operator_) {
        operator = operator_;
    }

    function start(Agent calldata a, bytes calldata sealedKey) external {
        if (sealedKey.length > MAX_SEALED_BYTES) revert TooLarge();
        Agent memory next = a;
        next.halted = false;
        agents[msg.sender] = next;
        sealedKeys[msg.sender] = sealedKey;
        if (slot[msg.sender] == 0) {
            owners.push(msg.sender);
            slot[msg.sender] = owners.length;
        }
        emit Started(msg.sender, a.follower, a.leader);
    }

    function stop() external {
        _remove(msg.sender);
        emit Stopped(msg.sender);
    }

    /// @notice Operator marks an agent halted after its loss cap was hit and positions flattened.
    function halt(address owner, string calldata reason) external {
        if (msg.sender != operator) revert NotOperator();
        if (slot[owner] == 0) revert NotActive();
        agents[owner].halted = true;
        emit Halted(owner, reason);
    }

    function count() external view returns (uint256) {
        return owners.length;
    }

    /// @notice Active agents without key material, for the CRE workflow and the app.
    function list(uint256 offset, uint256 limit) external view returns (address[] memory who, Agent[] memory what) {
        uint256 end = offset + limit > owners.length ? owners.length : offset + limit;
        uint256 n = end > offset ? end - offset : 0;
        who = new address[](n);
        what = new Agent[](n);
        for (uint256 i = 0; i < n; i++) {
            who[i] = owners[offset + i];
            what[i] = agents[who[i]];
        }
    }

    function _remove(address owner) private {
        uint256 s = slot[owner];
        if (s == 0) revert NotActive();
        address last = owners[owners.length - 1];
        owners[s - 1] = last;
        slot[last] = s;
        owners.pop();
        delete slot[owner];
        delete agents[owner];
        delete sealedKeys[owner];
    }
}
