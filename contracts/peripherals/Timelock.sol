// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/ITimelockTarget.sol";
import "../core/interfaces/IVault.sol";

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

contract Timelock {
    using SafeMath for uint256;

    uint256 public constant BUFFER = 5 days;

    address public admin;

    mapping (bytes32 => uint256) public pendingActions;

    event SignalPendingAction(bytes32 action);
    event SignalApprove(address token, address spender, uint256 amount, bytes32 action);
    event SignalSetGov(address target, address gov, bytes32 action);
    event SignalSetAmmPriceFeed(address target, address ammPriceFeed, bytes32 action);
    event ClearAction(bytes32 action);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Timelock: forbidden");
        _;
    }

    constructor() public {
        admin = msg.sender;
    }

    function enableMinting(address _vault) external onlyAdmin {
        IVault(_vault).enableMinting();
    }

    function setMaxStrictPriceDeviation(address _vault, uint256 _maxStrictPriceDeviation) external onlyAdmin {
        IVault(_vault).setMaxStrictPriceDeviation(_maxStrictPriceDeviation);
    }

    function setMaxUsdg(address _vault,uint256 _maxUsdgBatchSize, uint256 _maxUsdgBuffer) external onlyAdmin {
        IVault(_vault).setMaxUsdg(_maxUsdgBatchSize, _maxUsdgBuffer);
    }

    function setPriceSampleSpace(address _vault,uint256 _priceSampleSpace) external onlyAdmin {
        IVault(_vault).setPriceSampleSpace(_priceSampleSpace);
    }

    function setMaxGasPrice(address _vault,uint256 _maxGasPrice) external onlyAdmin {
        IVault(_vault).setMaxGasPrice(_maxGasPrice);
    }

    function withdrawFees(address _vault,address _token, address _receiver) external onlyAdmin {
        IVault(_vault).withdrawFees(_token, _receiver);
    }

    function signalApprove(address _token, address _spender, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount));
        _setPendingAction(action);
        emit SignalApprove(_token, _spender, _amount, action);
    }

    function approve(address _token, address _spender, uint256 _amount) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("approve", _token, _spender, _amount));
        _validateAction(action);
        IERC20(_token).approve(_spender, _amount);
        _clearAction(action);
    }

    function signalSetGov(address _target, address _gov) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        _setPendingAction(action);
        emit SignalSetGov(_target, _gov, action);
    }

    function setGov(address _target, address _gov) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setGov", _target, _gov));
        _validateAction(action);
        ITimelockTarget(_target).setGov(_gov);
        _clearAction(action);
    }

    function signalSetAmmPriceFeed(address _vault, address _ammPriceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setAmmPriceFeed", _vault, _ammPriceFeed));
        _setPendingAction(action);
        emit SignalSetAmmPriceFeed(_vault, _ammPriceFeed, action);
    }

    function setAmmPriceFeed(address _vault, address _ammPriceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setAmmPriceFeed", _vault, _ammPriceFeed));
        _validateAction(action);
        IVault(_vault).setAmmPriceFeed(_ammPriceFeed);
        _clearAction(action);
    }

    function cancelAction(bytes32 _action) external onlyAdmin {
        _clearAction(_action);
    }

    function _setPendingAction(bytes32 _action) private {
        pendingActions[_action] = block.timestamp.add(BUFFER);
        emit SignalPendingAction(_action);
    }

    function _validateAction(bytes32 _action) private view {
        require(pendingActions[_action] != 0, "Timelock: action not signalled");
        require(pendingActions[_action] < block.timestamp, "Timelock: action time not yet passed");
    }

    function _clearAction(bytes32 _action) private {
        require(pendingActions[_action] != 0, "Timelock: invalid _action");
        delete pendingActions[_action];
        emit ClearAction(_action);
    }
}
