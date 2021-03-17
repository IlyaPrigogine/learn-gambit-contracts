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
        uint256 collateral;
        uint256 averagePrice;
        uint256 entryFundingRate;
    }

    uint256 constant BASIS_POINTS_DIVISOR = 10000;
    uint256 constant FUNDING_RATE_PRECISION = 1000000;
    uint256 constant MIN_LEVERAGE = 10000;

    bool public isInitialized;

    address public gusd;
    address public gov;

    uint256 public liquidationFeeUsd = 5; // 5 USD
    uint256 public maxLeverage = 500000; // 50x

    // with the default settings, the funding rate will be 0.3% * utilisation ratio
    // where 3000 / 1000000 => 0.3%,
    // and utilisation ratio => reservedAmounts[_token] / _token.balanceOf(address(this))
    uint256 public fundingInterval = 8 hours;
    uint256 public fundingRateFactor = 3000;
    uint256 public lastFundingTime;

    uint256 public swapFeeBasisPoints = 20; // 0.2%
    uint256 public marginFeeBasisPoints = 2; // 0.02%

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

    mapping (bytes32 => Position) public positions;

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

        uint256 amountAfterFees = _collectSwapFees(_token, _tokenAmount);
        uint256 mintAmount = amountAfterFees.mul(price).div(pricePrecision);
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

        uint256 amountAfterFees = _collectSwapFees(_token, tokenAmount);

        gusdAmounts[_token] = gusdAmounts[_token].sub(_gusdAmount);

        IGUSD(gusd).burn(msg.sender, _gusdAmount);
        _transferOut(_token, amountAfterFees, _receiver);
    }

    function depositCollateral(address _collateralToken, address _indexToken, uint256 _collateral, bool _isLong) external nonReentrant {
        require(_collateral > 0, "Vault: invalid _collateral");

        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        _transferIn(_collateralToken, usdToTokenMax(_collateralToken, _collateral));

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];

        _collectMarginFees(_collateralToken, 0, position.size, position.entryFundingRate);

        position.collateral = position.collateral.add(_collateral);
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        _validateCollateral(_collateralToken, position.size, position.collateral, hasProfit, delta);
    }

    function withdrawCollateral(address _collateralToken, address _indexToken, uint256 _collateral, bool _isLong) external nonReentrant {
        require(_collateral > 0, "Vault: invalid _collateral");

        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];

        _collectMarginFees(_collateralToken, 0, position.size, position.entryFundingRate);

        position.collateral = position.collateral.sub(_collateral);
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        _validateCollateral(_collateralToken, position.size, position.collateral, hasProfit, delta);

        _transferOut(_collateralToken, usdToTokenMin(_collateralToken, _collateral), msg.sender);
    }

    function increasePosition(address _collateralToken, address _indexToken, uint256 _collateral, uint256 _size, bool _isLong) external nonReentrant {
        require(_size > 0, "Vault: invalid _size");
        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];

        uint256 price = _isLong ? getMaxPrice(_indexToken) : getMinPrice(_indexToken);

        if (position.averagePrice == 0) {
            position.averagePrice = price;
        } else {
            uint256 qtyDelta = _size.div(price);
            uint256 qty = position.size.div(position.averagePrice).add(qtyDelta);
            position.averagePrice = _size.div(qty);
        }

        uint256 fee = _collectMarginFees(_collateralToken, _size, position.size, position.entryFundingRate);

        uint256 collateral = position.collateral;
        if (_collateral > 0) {
            _transferIn(_collateralToken, usdToTokenMax(_collateralToken, _collateral));
            collateral = collateral.add(_collateral);
        }

        position.collateral = collateral.sub(fee);
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];
        position.size = position.size.add(_size);

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        _validateCollateral(_collateralToken, position.size, position.collateral, hasProfit, delta);
        _increaseReservedAmount(_indexToken, usdToTokenMax(_indexToken, _size));
    }

    function decreasePosition(address _collateralToken, address _indexToken, uint256 _collateral, uint256 _size, bool _isLong) external nonReentrant {
        require(_size > 0, "Vault: invalid _size");
        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];
        require(position.size > 0, "Vault: empty position");

        uint256 fee = _collectMarginFees(_collateralToken, _size, position.size, position.entryFundingRate);

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        uint256 amountOut = _collateral;

        if (hasProfit) {
            amountOut = _size.mul(delta).div(position.size);
        }

        if (_collateral > 0) {
            position.collateral = position.collateral.sub(_collateral);
        }

        position.collateral = position.collateral.sub(fee);
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];
        position.size = position.size.sub(_size);

        _validateCollateral(_collateralToken, position.size, position.collateral, hasProfit, delta);
        _decreaseReservedAmount(_indexToken, usdToTokenMin(_indexToken, _size));
        if (amountOut > 0) { _transferOut(_collateralToken, amountOut, msg.sender); }
    }

    function liquidatePosition(address _account, address _collateralToken, address _indexToken, bool _isLong, address _feeReceiver) external nonReentrant {
        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);
        _liquidatePosition(_account, _collateralToken, _indexToken, _isLong, _feeReceiver);
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

    function getLiquidationFee(address _token) public view returns (uint256) {
        uint256 pricePrecision = getPricePrecision(_token);
        return liquidationFeeUsd.mul(pricePrecision);
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

    function usdToTokenMax(address _token, uint256 _usdAmount) public view returns (uint256) {
        uint256 price = getMinPrice(_token);
        return _usdAmount.div(price);
    }

    function getPositionKey(address _account, address _collateralToken, address _indexToken, bool _isLong) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            _account,
            _collateralToken,
            _indexToken,
            _isLong
        ));
    }

    function updateCumulativeFundingRate(address _token) public {
        if (lastFundingTime.add(fundingInterval) > block.timestamp) {
            return;
        }

        uint256 fundingRate = getNextFundingRate(_token);
        cumulativeFundingRates[_token] = cumulativeFundingRates[_token].add(fundingRate);
        lastFundingTime = block.timestamp.div(fundingInterval).mul(fundingInterval);
    }

    function getNextFundingRate(address _token) public view returns (uint256) {
        if (lastFundingTime.add(fundingInterval) > block.timestamp) {
            return 0;
        }

        uint256 intervals = block.timestamp.sub(lastFundingTime).div(fundingInterval);
        uint256 balance = IERC20(_token).balanceOf(address(this));
        return fundingRateFactor.mul(reservedAmounts[_token]).mul(intervals).div(balance);
    }

    function getDelta(address _indexToken, uint256 _size, uint256 _averagePrice, bool _isLong) public view returns (bool, uint256) {
        uint256 price = _isLong ? getMinPrice(_indexToken) : getMaxPrice(_indexToken);
        uint256 priceDelta = _averagePrice > price ? _averagePrice.sub(price) : price.sub(_averagePrice);
        uint256 sizeDelta = _size.mul(priceDelta).div(_averagePrice);

        if (_isLong) {
            bool hasProfit = price > _averagePrice;
            return (hasProfit, sizeDelta);
        }

        bool hasProfit = _averagePrice > price;
        return (hasProfit, sizeDelta);
    }

    function getFundingFee(address _token, uint256 _positionSize, uint256 _entryFundingRate) public view returns (uint256) {
        if (_positionSize == 0) { return 0; }

        uint256 fundingRate = cumulativeFundingRates[_token].sub(_entryFundingRate);
        if (fundingRate == 0) { return 0; }

        uint256 fundingFee = _positionSize.mul(fundingRate).div(FUNDING_RATE_PRECISION);
        return fundingFee;
    }

    function _liquidatePosition(address _account, address _collateralToken, address _indexToken, bool _isLong, address _feeReceiver) public {
        bytes32 key = getPositionKey(_account, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];
        if (position.size == 0) { return; }

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        uint256 fundingFee = getFundingFee(_collateralToken, position.size, position.entryFundingRate);

        if (hasProfit && position.collateral.add(delta) > fundingFee) {
            return;
        }

        if (!hasProfit && position.collateral > delta.add(fundingFee)) {
            return;
        }

        if (fundingFee > position.collateral) {
            fundingFee = position.collateral;
        }

        _decreaseReservedAmount(_indexToken, position.size.div(position.averagePrice));

        uint256 liquidationFee = getLiquidationFee(_collateralToken);
        _transferOut(_collateralToken, usdToTokenMin(_collateralToken, liquidationFee), _feeReceiver);

        feeReserves[_collateralToken] = feeReserves[_collateralToken].add(usdToTokenMin(_collateralToken, fundingFee));

        delete positions[key];
    }

    function _validateCollateral(address _collateralToken, uint256 _size, uint256 _collateral, bool _hasProfit, uint256 _delta) private view {
        if (!_hasProfit && _delta >= _collateral) {
            revert("Vault: position should be liquidated");
        }
        uint256 remainingCollateral = _hasProfit ? _collateral.add(_delta) : _collateral.sub(_delta);
        require(_size.div(remainingCollateral).mul(BASIS_POINTS_DIVISOR) <= maxLeverage, "Vault: maxLeverage exceeded");
        require(_collateral > getLiquidationFee(_collateralToken), "Vault: insufficient collateral");
    }

    function _validateTokens(address _collateralToken, address _indexToken, bool _isLong) private view {
        if (_isLong) {
            require(_collateralToken == _indexToken, "Vault: mismatched tokens");
            require(whitelistedTokens[_collateralToken], "Vault: _collateralToken not whitelisted");
            require(!stableTokens[_collateralToken], "Vault: _collateralToken must not be a stableToken");
            return;
        }

        // _indexToken is intentionally not enforced to be a whitelisted token for shorts
        // it just needs to have a valid priceFeed
        // this adds flexbility by allowing shorting on non-whitelisted tokens
        require(whitelistedTokens[_collateralToken], "Vault: _collateralToken not whitelisted");
        require(stableTokens[_collateralToken], "Vault: _collateralToken must be a stableToken");
        require(!stableTokens[_indexToken], "Vault: _indexToken must not be a stableToken");
    }

    function _collectSwapFees(address _token, uint256 _amount) private returns (uint256) {
        uint256 feeAmount = _amount.mul(swapFeeBasisPoints).div(BASIS_POINTS_DIVISOR);
        feeReserves[_token] = feeReserves[_token].add(feeAmount);
        return _amount.sub(feeAmount);
    }

    function _collectMarginFees(address _token, uint256 _size, uint256 _positionSize, uint256 _entryFundingRate) private returns (uint256) {
        uint256 feeUsd = _size.mul(marginFeeBasisPoints).div(BASIS_POINTS_DIVISOR);
        uint256 fundingFee = getFundingFee(_token, _positionSize, _entryFundingRate);
        feeUsd = feeUsd.add(fundingFee);

        uint256 feeTokens = usdToTokenMax(_token, feeUsd);
        feeReserves[_token] = feeReserves[_token].add(feeTokens);

        return feeUsd;
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

    function _decreaseReservedAmount(address _token, uint256 _amount) private {
        reservedAmounts[_token] = reservedAmounts[_token].sub(_amount);
    }
}
