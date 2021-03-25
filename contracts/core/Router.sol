
// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";

import "../tokens/interfaces/IWETH.sol";
import "./interfaces/IVault.sol";

contract Router {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct SwapOrder {
        address account;
        address[] path;
        uint256 amountIn;
        uint256 minOut;
        address receiver;
        uint256 relayerFee;
    }

    struct IncreasePositionOrder {
        address account;
        address[] path;
        address indexToken;
        uint256 amountIn;
        uint256 sizeDelta;
        bool isLong;
        uint256 price;
        uint256 relayerFee;
    }

    struct DecreasePositionOrder {
        address account;
        address collateralToken;
        address indexToken;
        uint256 collateralDelta;
        uint256 sizeDelta;
        bool isLong;
        address receiver;
        uint256 price;
        uint256 stopPrice;
        uint256 relayerFee;
    }

    // wrapped BNB / ETH
    address public weth;
    address public usdg;
    address public vault;

    mapping (bytes32 => SwapOrder) public swapOrders;
    mapping (bytes32 => IncreasePositionOrder) public increasePositionOrders;
    mapping (bytes32 => DecreasePositionOrder) public decreasePositionOrders;

    constructor(address _weth, address _usdg, address _vault) public {
        weth = _weth;
        usdg = _usdg;
        vault = _vault;
    }

    receive() external payable {}

    function storeSwap(address[] memory _path, uint256 _amountIn, uint256 _minOut, address _receiver, uint256 _nonce, uint256 _relayerFee) external {
        bytes32 id = getId(_sender(), _nonce);
        swapOrders[id] = SwapOrder(
            _sender(),
            _path,
            _amountIn,
            _minOut,
            _receiver,
            _relayerFee
        );
    }

    function execSwap(bytes32 _id) external {
        SwapOrder memory order = swapOrders[_id];
        IERC20(order.path[0]).safeTransferFrom(order.account, vault, order.amountIn);

        uint256 amountOut = _swap(order.path, order.minOut, address(this));
        IERC20(order.path[order.path.length - 1]).safeTransfer(msg.sender, order.relayerFee);
        IERC20(order.path[order.path.length - 1]).safeTransfer(order.receiver, amountOut.sub(order.relayerFee));

        delete swapOrders[_id];
    }

    function cancelSwap(bytes32 _id) external {
        delete swapOrders[_id];
    }

    function storeIncreasePosition(address[] memory _path, address _indexToken, uint256 _amountIn, uint256 _sizeDelta, bool _isLong, uint256 _price, uint256 _nonce, uint256 _relayerFee) external payable {
        bytes32 id = getId(_sender(), _nonce);
        increasePositionOrders[id] = IncreasePositionOrder(
            _sender(),
            _path,
            _indexToken,
            _amountIn,
            _sizeDelta,
            _isLong,
            _price,
            _relayerFee
        );
    }

    function execIncreasePosition(bytes32 _id) external {
        IncreasePositionOrder memory order = increasePositionOrders[_id];
        IERC20(order.path[0]).safeTransferFrom(order.account, msg.sender, order.relayerFee);
        if (order.amountIn > order.relayerFee) {
            IERC20(order.path[0]).safeTransferFrom(order.account, vault, order.amountIn.sub(order.relayerFee));
        }
        if (order.path.length > 1) {
            _swap(order.path, type(uint256).max, vault);
        }
        _increasePosition(order.path[order.path.length - 1], order.indexToken, order.sizeDelta, order.isLong, order.price);

        delete increasePositionOrders[_id];
    }

    function cancelIncreasePosition(bytes32 _id) external {
        delete increasePositionOrders[_id];
    }

    function storeDecreasePosition(address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price, uint256 _stopPrice, uint256 _nonce, uint256 _relayerFee) external payable {
        bytes32 id = getId(_sender(), _nonce);
        decreasePositionOrders[id] = DecreasePositionOrder(
            _sender(),
            _collateralToken,
            _indexToken,
            _collateralDelta,
            _sizeDelta,
            _isLong,
            _receiver,
            _price,
            _stopPrice,
            _relayerFee
        );
    }

    function execDecreasePosition(bytes32 _id) external {
        DecreasePositionOrder memory order = decreasePositionOrders[_id];
        if (order.stopPrice != 0) {

        }

        uint256 amountOut = _decreasePosition(order.collateralToken, order.indexToken, order.collateralDelta, order.sizeDelta, order.isLong, address(this), order.price);
        if (amountOut > order.relayerFee) {
            IERC20(order.collateralToken).safeTransfer(msg.sender, order.relayerFee);
            IERC20(order.collateralToken).safeTransfer(order.receiver, amountOut.sub(order.relayerFee));
        } else {
            IERC20(order.collateralToken).safeTransferFrom(order.account, msg.sender, order.relayerFee);
            IERC20(order.collateralToken).safeTransfer(order.receiver, amountOut);
        }

        delete increasePositionOrders[_id];
    }

    function swap(address[] memory _path, uint256 _amountIn, uint256 _minOut, address _receiver) public payable {
        IERC20(_path[0]).safeTransferFrom(_sender(), vault, _amountIn);
        _swap(_path, _minOut, _receiver);
    }

    function swapETHToTokens(address[] memory _path, uint256 _minOut, address _receiver) external payable {
        require(_path[0] == weth, "Router: invalid _path");
        _transferETHToVault();
        _swap(_path, _minOut, _receiver);
    }

    function swapTokensToETH(address[] memory _path, uint256 _amountIn, uint256 _minOut, address _receiver) external {
        require(_path[_path.length - 1] == weth, "Router: invalid _path");
        IERC20(_path[0]).safeTransferFrom(_sender(), vault, _amountIn);
        uint256 amountOut = _swap(_path, _minOut, address(this));
        _transferOutETH(amountOut, _receiver);
    }

    function increasePosition(address[] memory _path, address _indexToken, uint256 _amountIn, uint256 _sizeDelta, bool _isLong, uint256 _price) external {
        IERC20(_path[0]).safeTransferFrom(_sender(), vault, _amountIn);
        if (_path.length > 1) {
            _swap(_path, type(uint256).max, vault);
        }
        _increasePosition(_path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function increasePositionETH(address[] memory _path, address _indexToken, uint256 _sizeDelta, bool _isLong, uint256 _price) external payable {
        require(_path[0] == weth, "Router: invalid _path");
        _transferETHToVault();
        if (_path.length > 1) {
            _swap(_path, type(uint256).max, vault);
        }
        _increasePosition(_path[_path.length - 1], _indexToken, _sizeDelta, _isLong, _price);
    }

    function decreasePosition(address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price) external {
        _decreasePosition(_collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver, _price);
    }

    function decreasePositionETH(address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price) external {
        uint256 amountOut = _decreasePosition(_collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver, _price);
        _transferOutETH(amountOut, _receiver);
    }

    function getId(address _account, uint256 _nonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _account,
            _nonce
        ));
    }

    function _increasePosition(address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong, uint256 _price) private {
        if (_isLong) {
            require(IVault(vault).getMaxPrice(_indexToken) <= _price, "Router: mark price higher than limit");
        } else {
            require(IVault(vault).getMinPrice(_indexToken) >= _price, "Router: mark price lower than limit");
        }

        IVault(vault).increasePosition(_sender(), _collateralToken, _indexToken, _sizeDelta, _isLong);
    }

    function _decreasePosition(address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price) private returns (uint256) {
        if (_isLong) {
            require(IVault(vault).getMinPrice(_indexToken) >= _price, "Router: mark price lower than limit");
        } else {
            require(IVault(vault).getMaxPrice(_indexToken) <= _price, "Router: mark price higher than limit");
        }

        return IVault(vault).decreasePosition(_sender(), _collateralToken, _indexToken, _collateralDelta, _sizeDelta, _isLong, _receiver);
    }

    function _transferETHToVault() private {
        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).safeTransfer(vault, msg.value);
    }

    function _transferOutETH(uint256 _amountOut, address _receiver) private {
        IWETH(weth).withdraw(_amountOut);
        IERC20(weth).safeTransfer(_receiver, _amountOut);
    }

    function _swap(address[] memory _path, uint256 _minOut, address _receiver) private returns (uint256) {
        if (_path.length == 2) {
            return _vaultSwap(_path[0], _path[1], _minOut, _receiver);
        }
        if (_path.length == 3) {
            _vaultSwap(_path[0], _path[1], type(uint256).max, vault);
            return _vaultSwap(_path[1], _path[2], _minOut, _receiver);
        }

        revert("Router: invalid _path.length");
    }

    function _vaultSwap(address _tokenIn, address _tokenOut, uint256 _minOut, address _receiver) private returns (uint256) {
        uint256 amountOut;

        if (_tokenOut == usdg) { // buyUSDG
            amountOut = IVault(vault).buyUSDG(_tokenIn, _receiver);
        } else if (_tokenIn == usdg) { // sellUSDG
            amountOut = IVault(vault).sellUSDG(_tokenOut, _receiver);
        } else { // swap
            amountOut = IVault(vault).swap(_tokenIn, _tokenOut, _receiver);
        }

        require(amountOut >= _minOut, "Router: insufficient amountOut");
        return amountOut;
    }

    function _sender() private view returns (address) {
        return msg.sender;
    }
}
