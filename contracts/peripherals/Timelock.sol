// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/ITimelockTarget.sol";

contract Timelock {
    uint256 public constant BUFFER = 5 days;

    address public admin;

    mapping (bytes32 => uint256) public pendingActions;

    event SignalSetGov(address indexed gov);
    event SignalWithdrawToken(address indexed token, address indexed account, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Timelock: forbidden");
        _;
    }

    constructor() public {
        admin = msg.sender;
    }

    function setAdmin(address _admin) external onlyAdmin {
        admin = _admin;
    }

    function signalSetGov(address _target, address _gov) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));

        setAction(action);
        emit SignalSetGov(_gov);
    }

    function signalWithdrawToken(address _target, address _token, address _account, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "withdrawToken",
            _target,
            _token,
            _account,
            _amount
        ));

        setAction(action);
        emit SignalWithdrawToken(_token, _account, _amount);
    }

    function setGov(address _target, address _gov) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        validateAction(action);

        ITimelockTarget(_target).setGov(_gov);
    }

    function withdrawToken(address _target, address _token, address _account, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked(
            "withdrawToken",
            _target,
            _token,
            _account,
            _amount
        ));
        validateAction(action);

        ITimelockTarget(_target).withdrawToken(_token, _account, _amount);
    }

    function setAction(bytes32 action) private {
        pendingActions[action] = block.timestamp + BUFFER;
    }

    function validateAction(bytes32 action) private view {
        require(pendingActions[action] != 0, "Timelock: action not signalled");
        require(pendingActions[action] < block.timestamp, "Timelock: action time not yet passed");
    }
}
