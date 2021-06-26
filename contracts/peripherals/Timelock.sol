// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/ITimelockTarget.sol";
import "../core/interfaces/IVault.sol";
import "../core/interfaces/IVaultPriceFeed.sol";
import "../core/interfaces/IRouter.sol";
import "../tokens/interfaces/IYieldToken.sol";

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

contract Timelock {
    using SafeMath for uint256;

    uint256 public constant PRICE_PRECISION = 10 ** 30;

    uint256 public buffer;
    address public admin;

    mapping (bytes32 => uint256) public pendingActions;

    event SignalPendingAction(bytes32 action);
    event SignalApprove(address token, address spender, uint256 amount, bytes32 action);
    event SignalSetGov(address target, address gov, bytes32 action);
    event SignalSetPriceFeed(address vault, address priceFeed, bytes32 action);
    event SignalAddPlugin(address router, address plugin, bytes32 action);
    event ClearAction(bytes32 action);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Timelock: forbidden");
        _;
    }

    constructor(uint256 _buffer) public {
        buffer = _buffer;
        admin = msg.sender;
    }

    function setFees(
        address _vault,
        uint256 _swapFeeBasisPoints,
        uint256 _stableSwapFeeBasisPoints,
        uint256 _marginFeeBasisPoints,
        uint256 _liquidationFeeUsd
    ) external onlyAdmin {
        require(_swapFeeBasisPoints < 100, "Timelock: invalid _swapFeeBasisPoints");
        require(_stableSwapFeeBasisPoints < 100, "Timelock: invalid _stableSwapFeeBasisPoints");
        require(_marginFeeBasisPoints < 100, "Timelock: invalid _marginFeeBasisPoints");
        require(_liquidationFeeUsd < 10 * PRICE_PRECISION, "Timelock: invalid _liquidationFeeUsd");

        IVault(_vault).setFees(
            _swapFeeBasisPoints,
            _stableSwapFeeBasisPoints,
            _marginFeeBasisPoints,
            _liquidationFeeUsd
        );
    }

    function setTokenConfig(
        address _vault,
        address _token,
        uint256 _minProfitBps
    ) external onlyAdmin {
        require(_minProfitBps <= 500, "Timelock: invalid _minProfitBps");

        IVault vault = IVault(_vault);
        uint256 tokenDecimals = vault.tokenDecimals(_token);
        uint256 redemptionBps = vault.redemptionBasisPoints(_token);
        bool isStable = vault.stableTokens(_token);
        bool isShortable = vault.shortableTokens(_token);

        IVault(_vault).setTokenConfig(
            _token,
            tokenDecimals,
            redemptionBps,
            _minProfitBps,
            isStable,
            isShortable
        );
    }

    function removeAdmin(address _token, address _account) external onlyAdmin {
        IYieldToken(_token).removeAdmin(_account);
    }

    function setIsAmmEnabled(address _priceFeed, bool _isEnabled) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setIsAmmEnabled(_isEnabled);
    }

    function setIsSecondaryPriceEnabled(address _priceFeed, bool _isEnabled) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setIsSecondaryPriceEnabled(_isEnabled);
    }

    function setMaxStrictPriceDeviation(address _priceFeed, uint256 _maxStrictPriceDeviation) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setMaxStrictPriceDeviation(_maxStrictPriceDeviation);
    }

    function setUseV2Pricing(address _priceFeed, bool _useV2Pricing) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setUseV2Pricing(_useV2Pricing);
    }

    function setSpreadBasisPoints(address _priceFeed, address _token, uint256 _spreadBasisPoints) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setSpreadBasisPoints(_token, _spreadBasisPoints);
    }

    function setSpreadThresholdBasisPoints(address _priceFeed, uint256 _spreadThresholdBasisPoints) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setSpreadThresholdBasisPoints(_spreadThresholdBasisPoints);
    }

    function setFavorPrimaryPrice(address _priceFeed, bool _favorPrimaryPrice) external onlyAdmin {
        IVaultPriceFeed(_priceFeed).setFavorPrimaryPrice(_favorPrimaryPrice);
    }

    function setPriceSampleSpace(address _priceFeed,uint256 _priceSampleSpace) external onlyAdmin {
        require(_priceSampleSpace <= 5, "Invalid _priceSampleSpace");
        IVaultPriceFeed(_priceFeed).setPriceSampleSpace(_priceSampleSpace);
    }

    function setIsMintingEnabled(address _vault, bool _isMintingEnabled) external onlyAdmin {
        IVault(_vault).setIsMintingEnabled(_isMintingEnabled);
    }

    function setIsSwapEnabled(address _vault, bool _isSwapEnabled) external onlyAdmin {
        IVault(_vault).setIsSwapEnabled(_isSwapEnabled);
    }

    function setMaxUsdg(address _vault,uint256 _maxUsdgBatchSize, uint256 _maxUsdgBuffer) external onlyAdmin {
        IVault(_vault).setMaxUsdg(_maxUsdgBatchSize, _maxUsdgBuffer);
    }

    function setMaxGasPrice(address _vault,uint256 _maxGasPrice) external onlyAdmin {
        require(_maxGasPrice > 5000000000, "Invalid _maxGasPrice");
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

    function signalSetPriceFeed(address _vault, address _priceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setPriceFeed", _vault, _priceFeed));
        _setPendingAction(action);
        emit SignalSetPriceFeed(_vault, _priceFeed, action);
    }

    function setPriceFeed(address _vault, address _priceFeed) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("setPriceFeed", _vault, _priceFeed));
        _validateAction(action);
        IVault(_vault).setPriceFeed(_priceFeed);
        _clearAction(action);
    }

    function signalAddPlugin(address _router, address _plugin) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("addPlugin", _router, _plugin));
        _setPendingAction(action);
        emit SignalAddPlugin(_router, _plugin, action);
    }

    function addPlugin(address _router, address _plugin) external onlyAdmin {
        bytes32 action = keccak256(abi.encodePacked("addPlugin", _router, _plugin));
        _validateAction(action);
        IRouter(_router).addPlugin(_plugin);
        _clearAction(action);
    }

    function cancelAction(bytes32 _action) external onlyAdmin {
        _clearAction(_action);
    }

    function _setPendingAction(bytes32 _action) private {
        pendingActions[_action] = block.timestamp.add(buffer);
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
