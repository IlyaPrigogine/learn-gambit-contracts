// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../tokens/interfaces/IWETH.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/Address.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IRouter.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IOrderBook.sol";
import "../tokens/interfaces/IWETH.sol";

import "hardhat/console.sol";

contract OrderBook is ReentrancyGuard, IOrderBook {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    struct Order {
        address account;
        uint256 index;
        address purchaseToken;
        uint256 purchaseTokenAmount;
        address indexToken;
        uint256 sizeDelta;
        bool isLong;
        uint256 triggerPrice;
        bool triggerAbovePrice;
        bool isIncrease;
        uint256 executionFee;
    }

    mapping (bytes32 => Order) public orders;
    mapping (address => uint256) public ordersIndex;

    address public gov;
    address public weth;
    address public usdg;
    address public router;
    address public vault;
    uint256 public executionGasLimit; // TODO set real
    uint256 public minGasPrice;
    address public defaultStablecoin;
    bool public isInitialized = false;

    event CreateOrder(
        address indexed account,
        uint256 indexed index,
        address purchaseToken,
        uint256 purchaseTokenAmount,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAbovePrice,
        bool isIncrease,
        uint256 executionFee
    );
    event CancelOrder(
        address indexed account,
        uint256 indexed index,
        address purchaseToken,
        uint256 purchaseTokenAmount,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAbovePrice,
        bool isIncrease,
        uint256 executionFee
    );
    event ExecuteOrder(
        address indexed account,
        uint256 indexed index,
        address purchaseToken,
        uint256 purchaseTokenAmount,
        address indexToken,
        uint256 sizeDelta,
        bool isLong,
        uint256 triggerPrice,
        bool triggerAbovePrice,
        bool isIncrease,
        uint256 executionFee,
        uint256 executionPrice
    );

    modifier onlyGov() {
        require(msg.sender == gov, "OrderBook: forbidden");
        _;
    }

    constructor() public {
        gov = msg.sender;
    }

    function initialize(
        address _router,
        address _vault,
        address _weth,
        address _usdg,
        uint256 _executionGasLimit,
        uint256 _minGasPrice,
        address _defaultStablecoin
    ) external onlyGov {
        require(!isInitialized, "OrderBook: already initialized");
        isInitialized = true;

        router = _router;
        vault = _vault;
        weth = _weth;
        usdg = _usdg;
        defaultStablecoin = _defaultStablecoin;
        executionGasLimit = _executionGasLimit;
        minGasPrice = _minGasPrice;
    }

    receive() external payable {
        require(msg.sender == weth, "OrderBook: invalid sender");
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }

    // Q do we need _minOut here?
    function createIncreasePositionOrder(
        address[] memory _path,
        uint256 _amountIn,
        address _indexToken,
        uint256 _minOut,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAbovePrice,
        uint256 _executionFee
    ) external payable {
        _transferInETH();

        IRouter(router).pluginTransfer(_path[0], msg.sender, address(this), _amountIn);
        address _purchaseToken = _path[_path.length - 1];
        uint256 _purchaseTokenAmount;
        if (_path.length > 1) {
            require(_path[0] != _purchaseToken, "OrderBook: invalid _path");
            IERC20(_path[0]).safeTransfer(vault, _amountIn);
            _purchaseTokenAmount = _swap(_path, _minOut, address(this));
        } else {
            _purchaseTokenAmount = _amountIn;
        }

        require(_executionFee > minGasPrice * executionGasLimit, "OrderBook: insufficient execution fee");
        require(msg.value == _executionFee, "OrderBook: insufficient execution fee transferred");

        // Q: do we need such validations here at all?
        // TODO require(position.collateral >= fee, "Vault: insufficient collateral for fees");
        // TODO validate leverage size

        _createOrder(
            msg.sender,
            _purchaseToken,
            _purchaseTokenAmount,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAbovePrice,
            true,
            _executionFee
        );
    }

    // not sure we need _receiver here
    function executeOrder(bytes32 _key, address payable _receiver) external nonReentrant {
        Order memory order = orders[_key];
        require(order.account != address(0), "OrderBook: non-existent order key");
        delete orders[_key];

        // actually the opposite could be desirable
        // e.g. user may want to open short position as soon as price "touches" threshold
        uint256 currentPrice = order.triggerAbovePrice 
            ? IVault(vault).getMinPrice(order.indexToken) : IVault(vault).getMaxPrice(order.indexToken);
        bool isPriceValid = order.triggerAbovePrice ? order.triggerPrice > currentPrice : order.triggerPrice < currentPrice;
        require(isPriceValid, "OrderBook: invalid price for execution");

        IERC20(order.purchaseToken).safeTransfer(vault, order.purchaseTokenAmount);

        // Q: allow user to explicitly specify collateralToken?
        address collateralToken = order.isLong ? order.indexToken : defaultStablecoin;

        if (order.purchaseToken != collateralToken) {
            address[] memory path = new address[](2);
            path[0] = order.purchaseToken;
            path[1] = collateralToken;

            // Q: can I swap and send to vault at once?
            uint256 amountOut = _swap(path, 0, address(this));
            IERC20(collateralToken).safeTransfer(vault, amountOut);
        }

        IRouter(router).pluginIncreasePosition(order.account, collateralToken, order.indexToken, order.sizeDelta, order.isLong);
        _transferOutETH(order.executionFee, _receiver);

        emit ExecuteOrder(
            order.account,
            order.index,
            order.purchaseToken,
            order.purchaseTokenAmount,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAbovePrice,
            order.isIncrease,
            order.executionFee,
            currentPrice
        );
    }

    function getOrderKey(address _address, uint256 _orderIndex) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _address,
            _orderIndex
        ));
    }

    // Q: or use _account and _index instead of _key
    function cancelOrder(bytes32 _key) external nonReentrant {
        // Q: specify _outputToken to auto swap?
        Order memory order = orders[_key];
        require(msg.sender == order.account, "OrderBook: forbidden");

        delete orders[_key];

        // return funds reserved for increasing position
        IERC20(order.purchaseToken).safeTransfer(msg.sender, order.purchaseTokenAmount);
        // and funds reserved for execution 
        _transferOutETH(order.executionFee, msg.sender);

        emit CancelOrder(
            order.account,
            order.index,
            order.purchaseToken,
            order.purchaseTokenAmount,
            order.indexToken,
            order.sizeDelta,
            order.isLong,
            order.triggerPrice,
            order.triggerAbovePrice,
            order.isIncrease,
            order.executionFee
        );
    }

    function _createOrder(
        address _account,
        address _purchaseToken,
        uint256 _purchaseTokenAmount,
        address _indexToken,
        uint256 _sizeDelta,
        bool _isLong,
        uint256 _triggerPrice,
        bool _triggerAbovePrice,
        bool _isIncrease,
        uint256 _executionFee
    ) private {
        uint256 _orderIndex = ordersIndex[msg.sender];
        Order memory order = Order(
            _account,
            _orderIndex,
            _purchaseToken,
            _purchaseTokenAmount,
            _indexToken,
            _sizeDelta,
            _isLong,
            _triggerPrice,
            _triggerAbovePrice,
            _isIncrease,
            _executionFee
        );
        bytes32 _key = getOrderKey(msg.sender, _orderIndex);
        ordersIndex[msg.sender] = _orderIndex.add(1);
        orders[_key] = order;

        emit CreateOrder(_account, _orderIndex, _purchaseToken, _purchaseTokenAmount, _indexToken, _sizeDelta, _isLong, _triggerPrice, _triggerAbovePrice, _isIncrease, _executionFee);
    }

    function _transferInETH() private {
        IWETH(weth).deposit{value: msg.value}();
    }

    function _transferOutETH(uint256 _amountOut, address payable _receiver) private {
        IWETH(weth).withdraw(_amountOut);
        _receiver.sendValue(_amountOut);
    }

    function _swap(address[] memory _path, uint256 _minOut, address _receiver) private returns (uint256) {
        if (_path.length == 2) {
            return _vaultSwap(_path[0], _path[1], _minOut, _receiver);
        }
        if (_path.length == 3) {
            uint256 midOut = _vaultSwap(_path[0], _path[1], 0, address(this));
            IERC20(_path[1]).safeTransfer(vault, midOut); 
            return _vaultSwap(_path[1], _path[2], _minOut, _receiver);
        }

        revert("OrderBook: invalid _path.length");
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

        require(amountOut >= _minOut, "OrderBook: insufficient amountOut");
        return amountOut;
    }
}
