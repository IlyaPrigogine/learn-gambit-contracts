// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IGUSD.sol";
import "./interfaces/IPriceFeed.sol";

contract Vault is ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct Position {
        uint256 size;
        uint256 entryPrice;
        uint256 leverage;
        uint256 reservedAmount;
    }

    uint256 constant BASIS_POINTS_DIVISOR = 10000;
    uint256 constant MIN_LEVERAGE = 10000;

    bool public isInitialized;

    address public gusd;
    address public gov;

    uint256 public maxLeverage = 500000; // 50x

    mapping (address => bool) public whitelistedTokens;
    mapping (address => bool) public stableTokens;
    mapping (address => address) public priceFeeds;
    mapping (address => uint256) public pricePrecisions;
    mapping (address => uint256) public redemptionBasisPoints;
    mapping (address => uint256) public tokenDecimals;

    mapping (address => uint256) public gusdAmounts;
    mapping (address => uint256) public reservedAmounts;

    mapping (address => mapping (address => Position)) public longPositions;

    modifier onlyGov() {
        require(msg.sender == gov, "GUSD: forbidden");
        _;
    }

    constructor() public {
        gov = msg.sender;
    }

    function initialize(
        address[] memory _addresses
    ) external onlyGov {
        gusd = _addresses[0];
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }

    function buyGUSD(address _token, uint256 _tokenAmount, address _receiver) external nonReentrant {
        require(_tokenAmount > 0, "Vault: invalid _tokenAmount");
        require(whitelistedTokens[_token], "Vault: _token not whitelisted");

        uint256 price = getMinPrice(_token);
        uint256 pricePrecision = getPricePrecision(_token);

        uint256 mintAmount = _tokenAmount.mul(price).div(pricePrecision);
        mintAmount = adjustForDecimals(mintAmount, _token, gusd);

        gusdAmounts[_token] = gusdAmounts[_token].add(mintAmount);

        _transferIn(_token, _tokenAmount);
        IGUSD(gusd).mint(_receiver, mintAmount);
    }

    function sellGUSD(address _token, uint256 _gusdAmount, address _receiver) external nonReentrant {
        require(_gusdAmount > 0, "Vault: invalid _gusdAmount");
        require(whitelistedTokens[_token], "Vault: _token not whitelisted");

        uint256 price = getMaxPrice(_token);
        uint256 pricePrecision = getPricePrecision(_token);

        uint256 tokenAmount = _gusdAmount.mul(pricePrecision).div(price);
        uint256 redemptionAmount = getRedemptionAmount(_token, _gusdAmount);
        if (tokenAmount > redemptionAmount) {
            tokenAmount = redemptionAmount;
        }

        gusdAmounts[_token] = gusdAmounts[_token].sub(_gusdAmount);

        IGUSD(gusd).burn(msg.sender, _gusdAmount);
        _transferOut(_token, tokenAmount, _receiver);
    }

    function updateLong(address _token, uint256 _collateralAmount, uint256 _leverage) external nonReentrant {
        require(whitelistedTokens[_token], "Vault: _token not whitelisted");
        require(!stableTokens[_token], "Vault: _token must not be a stableToken");
        require(_leverage > 0, "Vault: invalid _leverage");
        require(_leverage > MIN_LEVERAGE, "Vault: _leverage must be more than MIN_LEVERAGE");
        require(_leverage <= maxLeverage, "Vault: max leverage exceeded");

        uint256 existingCollateral = _closeLongPosition(msg.sender, _token);
        if (existingCollateral > _collateralAmount) {
            _transferOut(_token, existingCollateral.sub(_collateralAmount), msg.sender);
        }

        if (_collateralAmount == 0) { return; }

        if (_collateralAmount > existingCollateral) {
            _transferIn(_token, _collateralAmount.sub(existingCollateral));
        }

        uint256 borrowAmount = _collateralAmount.mul(_leverage).div(BASIS_POINTS_DIVISOR);
        _increaseReservedAmount(_token, borrowAmount);

        longPositions[msg.sender][_token] = Position(
            tokenToUsdMin(_token, _collateralAmount),
            getMaxPrice(_token),
            _leverage,
            borrowAmount
        );
    }

    function swap(address _tokenIn, address _tokenOut, uint256 _amountIn, address _receiver) external nonReentrant {
        require(_amountIn > 0, "Vault: invalid _amountIn");
        require(whitelistedTokens[_tokenIn], "Vault: _tokenIn not whitelisted");
        require(whitelistedTokens[_tokenOut], "Vault: _tokenOut not whitelisted");

        uint256 amountOut = getSwapAmountOut(_tokenIn, _tokenOut, _amountIn);

        gusdAmounts[_tokenIn] = gusdAmounts[_tokenIn].add(_amountIn);
        gusdAmounts[_tokenOut] = gusdAmounts[_tokenOut].sub(amountOut);

        _transferIn(_tokenIn, _amountIn);
        _transferOut(_tokenOut, amountOut, _receiver);
    }

    function getMinPrice(address _token) public view returns (uint256) {
        address priceFeed = priceFeeds[_token];
        require(priceFeed != address(0), "Vault: invalid price feed");

        int256 answer = IPriceFeed(priceFeed).latestAnswer();
        require(answer > 0, "Vault: invalid price");

        return uint256(answer);
    }

    function getMaxPrice(address _token) public view returns (uint256) {
        address priceFeed = priceFeeds[_token];
        require(priceFeed != address(0), "Vault: invalid price feed");

        int256 answer = IPriceFeed(priceFeed).latestAnswer();
        require(answer > 0, "Vault: invalid price");

        return uint256(answer);
    }

    function getPricePrecision(address _token) public view returns (uint256) {
        uint256 precision = pricePrecisions[_token];
        require(precision > 0, "Vault: invalid price precision");
        return precision;
    }

    function getRedemptionBasisPoints(address _token) public view returns (uint256) {
        uint256 basisPoints = redemptionBasisPoints[_token];
        require(basisPoints > 0, "Vault: invalid redemption basis points");
        return basisPoints;
    }

    function getRedemptionAmount(address _token, uint256 _gusdAmount) public view returns (uint256) {
        uint256 tokenBalance = IERC20(_token).balanceOf(address(this));
        uint256 basisPoints = getRedemptionBasisPoints(_token);
        uint256 totalGusdAmount = gusdAmounts[_token];
        require(totalGusdAmount > 0, "Vault: invalid gusd amount");

        uint256 redemptionAmount = _gusdAmount.mul(tokenBalance).div(totalGusdAmount);
        redemptionAmount = redemptionAmount.mul(basisPoints).div(BASIS_POINTS_DIVISOR);

        return adjustForDecimals(redemptionAmount, gusd, _token);
    }

    function getSwapAmountOut(address _tokenIn, address _tokenOut, uint256 _amountIn) public view returns (uint256) {
        uint256 priceIn = getMinPrice(_tokenIn);
        uint256 precisionIn = getPricePrecision(_tokenIn);
        uint256 priceOut = getMaxPrice(_tokenOut);
        uint256 precisionOut = getPricePrecision(_tokenOut);

        uint256 amount = _amountIn.mul(priceIn).mul(precisionOut).div(priceOut).div(precisionIn);
        return adjustForDecimals(amount, _tokenIn, _tokenOut);
    }

    function adjustForDecimals(uint256 _amount, address _tokenDiv, address _tokenMul) public view returns (uint256) {
        uint256 decimalsDiv = tokenDecimals[_tokenDiv];
        uint256 decimalsMul = tokenDecimals[_tokenMul];
        return _amount.mul(10 ** decimalsMul).div(10 ** decimalsDiv);
    }

    function availableReserve(address _token) public view returns (uint256) {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        return balance.sub(reservedAmounts[_token]);
    }

    function tokenToUsdMin(address _token, uint256 _tokenAmount) public view returns (uint256) {
        uint256 price = getMaxPrice(_token);
        return _tokenAmount.mul(price);
    }

    function usdToTokenMin(address _token, uint256 _usdAmount) public view returns (uint256) {
        uint256 price = getMaxPrice(_token);
        return _usdAmount.div(price);
    }

    function _transferIn(address _token, uint256 _amount) private {
        uint256 tokenBefore = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        uint256 tokenAfter = IERC20(_token).balanceOf(address(this));
        require(tokenAfter.sub(tokenBefore) == _amount, "Vault: invalid transfer");
    }

    function _transferOut(address _token, uint256 _amount, address _receiver) private {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        uint256 newBalance = balance.sub(_amount);
        require(newBalance >= reservedAmounts[_token], "Vault: reserve limit exceeded");
        IERC20(_token).safeTransfer(_receiver, _amount);
    }

    function _increaseReservedAmount(address _token, uint256 _amount) private {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        reservedAmounts[_token] = reservedAmounts[_token].add(_amount);
        require(reservedAmounts[_token] <= balance, "Vault: insufficient reserve");
    }

    function _validateReserveAmount(address _token) private view {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(reservedAmounts[_token] <= balance, "Vault: reserve limit exceeded");
    }

    function _closeLongPosition(address _account, address _token) private returns (uint256) {
        Position storage position = longPositions[_account][_token];
        if (position.size == 0) {
            return 0;
        }

        reservedAmounts[_token] = reservedAmounts[_token].sub(position.reservedAmount);
        position.size = 0;
        position.reservedAmount = 0;

        uint256 currentPrice = getMinPrice(_token);
        bool hasProfit = currentPrice > position.entryPrice;
        uint256 priceDelta = hasProfit ? currentPrice.sub(position.entryPrice) : position.entryPrice.sub(currentPrice);
        uint256 delta = position.size.mul(priceDelta).mul(position.leverage).div(position.entryPrice).div(BASIS_POINTS_DIVISOR).div(BASIS_POINTS_DIVISOR);

        if (hasProfit) {
            uint256 newSize = position.size.add(delta);
            return usdToTokenMin(_token, newSize);
        }

        if (delta >= position.size) {
            return 0; // user's position has been liquidated
        }

        uint256 newSize = position.size.sub(delta);
        return usdToTokenMin(_token, newSize);
    }
}
