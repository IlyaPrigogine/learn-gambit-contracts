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
        uint256 entryFundingRate;
    }

    uint256 constant BASIS_POINTS_DIVISOR = 10000;
    uint256 constant FUNDING_RATE_PRECISION = 1000000;
    uint256 constant MIN_LEVERAGE = 10000;

    bool public isInitialized;

    address public gusd;
    address public gov;

    uint256 public liquidationFeeBasisPoints = 20; // 0.2%
    uint256 public maxLeverage = 500000; // 50x

    // with the default settings, the funding rate will be 0.3% * utilisation ratio
    // where 3000 / 1000000 => 0.3%,
    // and utilisation ratio => reservedAmounts[_token] / _token.balanceOf(address(this))
    uint256 public fundingInterval = 8 hours;
    uint256 public fundingRateFactor = 3000;
    uint256 public lastFundingTime;

    mapping (address => bool) public whitelistedTokens;
    mapping (address => bool) public stableTokens;
    mapping (address => address) public priceFeeds;
    mapping (address => uint256) public pricePrecisions;
    mapping (address => uint256) public redemptionBasisPoints;
    mapping (address => uint256) public tokenDecimals;

    mapping (address => uint256) public gusdAmounts;
    mapping (address => uint256) public reservedAmounts;
    mapping (address => uint256) public cumulativeFundingRates;
    mapping (address => uint256) public feeReserves;

    mapping (bytes32 => Position) public longPositions;
    mapping (bytes32 => Position) public shortPositions;

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
        updateCumulativeFundingRate(_token);

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
        updateCumulativeFundingRate(_token);

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
        require(_leverage > MIN_LEVERAGE, "Vault: _leverage must be more than MIN_LEVERAGE");
        require(_leverage <= maxLeverage, "Vault: max leverage exceeded");
        updateCumulativeFundingRate(_token);

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

        bytes32 key = getLongPositionKey(msg.sender, _token);
        longPositions[key] = Position(
            tokenToUsdMin(_token, _collateralAmount),
            getMaxPrice(_token),
            _leverage,
            borrowAmount,
            cumulativeFundingRates[_token]
        );
    }

    function updateShort(address _collateralToken, address _indexToken, uint256 _collateralAmount, uint256 _leverage) external nonReentrant {
        require(whitelistedTokens[_collateralToken], "Vault: _collateralToken not whitelisted");
        require(stableTokens[_collateralToken], "Vault: _collateralToken must be a stableToken");
        require(_leverage > MIN_LEVERAGE, "Vault: _leverage must be more than MIN_LEVERAGE");
        require(_leverage <= maxLeverage, "Vault: max leverage exceeded");
        updateCumulativeFundingRate(_collateralToken);

        // _indexToken is intentionally not enforced to be a whitelisted token
        // it just needs to have a valid priceFeed
        // this adds flexbility by allowing shorting on non-whitelisted tokens

        uint256 existingCollateral = _closeShortPosition(msg.sender, _collateralToken, _indexToken);
        if (existingCollateral > _collateralAmount) {
            _transferOut(_collateralToken, existingCollateral.sub(_collateralAmount), msg.sender);
        }

        if (_collateralAmount == 0) { return; }

        if (_collateralAmount > existingCollateral) {
            _transferIn(_collateralToken, _collateralAmount.sub(existingCollateral));
        }

        uint256 borrowAmount = _collateralAmount.mul(_leverage).div(BASIS_POINTS_DIVISOR);
        _increaseReservedAmount(_collateralToken, borrowAmount);

        bytes32 key = getShortPositionKey(msg.sender, _collateralToken, _indexToken);
        shortPositions[key] = Position(
            tokenToUsdMin(_collateralToken, _collateralAmount),
            getMaxPrice(_indexToken),
            _leverage,
            borrowAmount,
            cumulativeFundingRates[_collateralToken]
        );
    }

    function liquidateLong(address _account, address _token, address _feeReceiver) external nonReentrant {
        updateCumulativeFundingRate(_token);
        require(shouldLiquidateLong(_account, _token), "Vault: long should not be liquidated");

        bytes32 key = getLongPositionKey(_account, _token);
        Position memory position = longPositions[key];
        uint256 liquidationFee = usdToTokenMin(_token, position.size).mul(liquidationFeeBasisPoints).div(BASIS_POINTS_DIVISOR);

        _closeLongPosition(_account, _token);
        _transferOut(_token, liquidationFee, _feeReceiver);
    }

    function liquidateShort(address _account, address _collateralToken, address _indexToken, address _feeReceiver) external nonReentrant {
        updateCumulativeFundingRate(_collateralToken);
        require(shouldLiquidateShort(_account, _collateralToken, _indexToken), "Vault: short should not be liquidated");

        bytes32 key = getShortPositionKey(_account, _collateralToken, _indexToken);
        Position memory position = shortPositions[key];
        uint256 liquidationFee = usdToTokenMin(_collateralToken, position.size).mul(liquidationFeeBasisPoints).div(BASIS_POINTS_DIVISOR);

        _closeShortPosition(_account, _collateralToken, _indexToken);
        _transferOut(_collateralToken, liquidationFee, _feeReceiver);
    }

    function swap(address _tokenIn, address _tokenOut, uint256 _amountIn, address _receiver) external nonReentrant {
        require(_amountIn > 0, "Vault: invalid _amountIn");
        require(whitelistedTokens[_tokenIn], "Vault: _tokenIn not whitelisted");
        require(whitelistedTokens[_tokenOut], "Vault: _tokenOut not whitelisted");
        updateCumulativeFundingRate(_tokenIn);
        updateCumulativeFundingRate(_tokenOut);

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

    function shouldLiquidateLong(address _account, address _token) public view returns (bool) {
        bytes32 key = getLongPositionKey(_account, _token);
        Position memory position = longPositions[key];
        if (position.size == 0) { return false; }

        (bool hasProfit, uint256 delta, uint256 fundingFees) = getLongPositionDelta(_account, _token);
        return _shouldLiquidate(position.size, hasProfit, delta, fundingFees);
    }

    function shouldLiquidateShort(address _account, address _collateralToken, address _indexToken) public view returns (bool) {
        bytes32 key = getShortPositionKey(_account, _collateralToken, _indexToken);
        Position memory position = longPositions[key];
        if (position.size == 0) { return false; }

        (bool hasProfit, uint256 delta, uint256 fundingFees) = getShortPositionDelta(_account, _collateralToken, _indexToken);
        return _shouldLiquidate(position.size, hasProfit, delta, fundingFees);
    }

    function getLongPositionDelta(address _account, address _token) public view returns (bool, uint256, uint256) {
        bytes32 key = getLongPositionKey(_account, _token);
        Position memory position = longPositions[key];
        uint256 currentPrice = getMinPrice(_token);
        bool priceIncreased = currentPrice > position.entryPrice;
        uint256 delta;
        {
            uint256 priceDelta = priceIncreased ? currentPrice.sub(position.entryPrice) : position.entryPrice.sub(currentPrice);
            delta = position.size.mul(priceDelta).mul(position.leverage).div(position.entryPrice).div(BASIS_POINTS_DIVISOR).div(BASIS_POINTS_DIVISOR);
        }
        uint256 fundingFees;
        {
            uint256 fundingRate = cumulativeFundingRates[_token].sub(position.entryFundingRate);
            fundingFees = fundingRate.mul(position.size).mul(position.leverage).div(BASIS_POINTS_DIVISOR).div(FUNDING_RATE_PRECISION);
        }
        return (priceIncreased, delta, fundingFees);
    }

    function getShortPositionDelta(address _account, address _collateralToken, address _indexToken) public view returns (bool, uint256, uint256) {
        bytes32 key = getShortPositionKey(_account, _collateralToken, _indexToken);
        Position memory position = shortPositions[key];
        uint256 currentPrice = getMaxPrice(_indexToken);
        bool priceIncreased = currentPrice > position.entryPrice;
        uint256 delta;
        {
            uint256 priceDelta = priceIncreased ? currentPrice.sub(position.entryPrice) : position.entryPrice.sub(currentPrice);
            delta = position.size.mul(priceDelta).mul(position.leverage).div(position.entryPrice).div(BASIS_POINTS_DIVISOR).div(BASIS_POINTS_DIVISOR);
        }
        uint256 fundingFees;
        {
            uint256 fundingRate = cumulativeFundingRates[_collateralToken].sub(position.entryFundingRate);
            fundingFees = fundingRate.mul(position.size).mul(position.leverage).div(BASIS_POINTS_DIVISOR).div(FUNDING_RATE_PRECISION);
        }
        return (!priceIncreased, delta, fundingFees);
    }

    function getLongPositionKey(address _account, address _token) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _account,
            _token
        ));
    }

    function getShortPositionKey(address _account, address _collateralToken, address _indexToken) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _account,
            _collateralToken,
            _indexToken
        ));
    }

    function getNextFundingRate(address _token) public view returns (uint256) {
        if (lastFundingTime.add(fundingInterval) > block.timestamp) {
            return 0;
        }

        uint256 intervals = block.timestamp.sub(lastFundingTime).div(fundingInterval);
        uint256 balance = IERC20(_token).balanceOf(address(this));
        return fundingRateFactor.mul(reservedAmounts[_token]).mul(intervals).div(balance);
    }

    function updateCumulativeFundingRate(address _token) public {
        if (lastFundingTime.add(fundingInterval) > block.timestamp) {
            return;
        }

        uint256 fundingRate = getNextFundingRate(_token);
        cumulativeFundingRates[_token] = cumulativeFundingRates[_token].add(fundingRate);
        lastFundingTime = block.timestamp.div(fundingInterval).mul(fundingInterval);
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
        bytes32 key = getLongPositionKey(_account, _token);
        Position storage position = longPositions[key];
        if (position.size == 0) {
            return 0;
        }

        (bool hasProfit, uint256 delta, uint256 fundingFees) = getLongPositionDelta(_account, _token);
        uint256 nextSize = _getNextPositionSize(_token, position.size, hasProfit, delta, fundingFees);

        feeReserves[_token] = feeReserves[_token].add(usdToTokenMin(_token, fundingFees));
        reservedAmounts[_token] = reservedAmounts[_token].sub(position.reservedAmount);
        position.size = 0;
        position.reservedAmount = 0;

        return nextSize;
    }

    function _closeShortPosition(address _account, address _collateralToken, address _indexToken) private returns (uint256) {
        bytes32 key = getShortPositionKey(_account, _collateralToken, _indexToken);
        Position storage position = shortPositions[key];
        if (position.size == 0) {
            return 0;
        }

        (bool hasProfit, uint256 delta, uint256 fundingFees) = getShortPositionDelta(_account, _collateralToken, _indexToken);
        uint256 nextSize = _getNextPositionSize(_collateralToken, position.size, hasProfit, delta, fundingFees);

        feeReserves[_collateralToken] = feeReserves[_collateralToken].add(usdToTokenMin(_collateralToken, fundingFees));
        reservedAmounts[_collateralToken] = reservedAmounts[_collateralToken].sub(position.reservedAmount);
        position.size = 0;
        position.reservedAmount = 0;

        return nextSize;
    }

    function _getNextPositionSize(address _token, uint256 _positionSize, bool _hasProfit, uint256 _delta, uint256 _fundingFees) private view returns (uint256) {
        if (_hasProfit) {
            uint256 newSize = _positionSize.add(_delta);
            return newSize <= _fundingFees ? 0 : usdToTokenMin(_token, newSize.sub(_fundingFees));
        }

        if (_delta >= _positionSize) {
            return 0;
        }

        uint256 newSize = _positionSize.sub(_delta);
        return newSize <= _fundingFees ? 0 : usdToTokenMin(_token, newSize.sub(_fundingFees));
    }

    function _shouldLiquidate(uint256 _positionSize, bool _hasProfit, uint256 _delta, uint256 _fundingFees) private pure returns (bool) {
        if (_hasProfit) {
            uint256 newSize = _positionSize.add(_delta);
            return newSize <= _fundingFees;
        }

        if (_delta >= _positionSize) {
            return true;
        }

        uint256 newSize = _positionSize.sub(_delta);
        return newSize <= _fundingFees;
    }
}
