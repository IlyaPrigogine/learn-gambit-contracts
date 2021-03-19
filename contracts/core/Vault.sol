// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "./interfaces/IUSDG.sol";
import "../oracle/interfaces/IPriceFeed.sol";

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
    uint256 constant PRICE_PRECISION = 10 ** 18;
    uint256 constant MIN_LEVERAGE = 10000;

    bool public isInitialized;

    address public usdg;
    address public gov;
    uint256 public govUnlockTime;

    uint256 public liquidationFeeUsd;
    uint256 public maxLeverage = 500000; // 50x
    uint256 public priceSampleSpace = 3;

    // with the default settings, the funding rate will be 0.06% * utilisation ratio
    // where 600 / 1000000 => 0.06%,
    // and utilisation ratio => reservedAmounts[_token] / _token.balanceOf(address(this))
    uint256 public fundingInterval = 8 hours;
    uint256 public fundingRateFactor = 600;

    uint256 public swapFeeBasisPoints = 20; // 0.2%
    uint256 public marginFeeBasisPoints = 2; // 0.02%

    mapping (address => bool) public whitelistedTokens;
    mapping (address => address) public priceFeeds;
    mapping (address => uint256) public priceDecimals;
    mapping (address => uint256) public redemptionBasisPoints;
    mapping (address => uint256) public tokenDecimals;
    mapping (address => bool) public stableTokens;

    mapping (address => uint256) public usdgAmounts;
    mapping (address => uint256) public poolAmounts;
    mapping (address => uint256) public reservedAmounts;
    mapping (address => uint256) public guaranteedUsd;
    mapping (address => uint256) public cumulativeFundingRates;
    mapping (address => uint256) public lastFundingTimes;
    mapping (address => uint256) public tokenBalances;

    mapping (address => uint256) public feeReserves;
    mapping (bytes32 => Position) public positions;

    modifier onlyGov() {
        require(msg.sender == gov, "Vault: forbidden");
        _;
    }

    modifier afterGovUnlockTime() {
        require(block.timestamp > govUnlockTime, "Vault: govUnlockTime has not yet passed");
        _;
    }

    constructor() public {
        gov = msg.sender;
    }

    function initialize(address _usdg, uint256 _liquidationFeeUsd) external onlyGov {
        require(!isInitialized, "Vault: already initialized");
        isInitialized = true;

        usdg = _usdg;
        liquidationFeeUsd = _liquidationFeeUsd.mul(PRICE_PRECISION);

        tokenDecimals[usdg] = 18;
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }

    function extendGovUnlockTime(uint256 _govUnlockTime) external onlyGov {
        require(_govUnlockTime > govUnlockTime, "Vault: invalid _govUnlockTime");
        govUnlockTime = _govUnlockTime;
    }

    function addWhitelistedToken(
        address _token,
        address _priceFeed,
        uint256 _priceDecimals,
        uint256 _redemptionBps,
        uint256 _tokenDecimals,
        bool _isStable
    ) external nonReentrant onlyGov afterGovUnlockTime {
        require(!whitelistedTokens[_token], "Vault: token already whitelisted");

        whitelistedTokens[_token] = true;
        priceFeeds[_token] = _priceFeed;
        priceDecimals[_token] = _priceDecimals;
        redemptionBasisPoints[_token] = _redemptionBps;
        tokenDecimals[_token] = _tokenDecimals;
        stableTokens[_token] = _isStable;

        // validate price feed
        getMaxPrice(_token);
    }

    function removeWhitelistedToken(address _token) external nonReentrant onlyGov afterGovUnlockTime {
        require(whitelistedTokens[_token], "Vault: token not whitelisted");
        delete whitelistedTokens[_token];
        delete priceFeeds[_token];
        delete priceDecimals[_token];
        delete redemptionBasisPoints[_token];
        delete tokenDecimals[_token];
        delete stableTokens[_token];
    }

    function buyUSDG(address _token, address _receiver) external nonReentrant {
        require(whitelistedTokens[_token], "Vault: _token not whitelisted");

        uint256 tokenAmount = _transferIn(_token);
        require(tokenAmount > 0, "Vault: invalid tokenAmount");

        updateCumulativeFundingRate(_token);

        uint256 price = getMinPrice(_token);

        uint256 amountAfterFees = _collectSwapFees(_token, tokenAmount);
        uint256 mintAmount = amountAfterFees.mul(price).div(PRICE_PRECISION);
        mintAmount = adjustForDecimals(mintAmount, _token, usdg);
        require(mintAmount > 0, "Vault: invalid mintAmount");

        IUSDG(usdg).mint(_receiver, mintAmount);

        _increaseUsdgAmount(_token, mintAmount);
        _increasePoolAmount(_token, tokenAmount);
    }

    function sellUSDG(address _token, address _receiver) external nonReentrant {
        require(whitelistedTokens[_token], "Vault: _token not whitelisted");

        uint256 usdgAmount = _transferIn(usdg);
        require(usdgAmount > 0, "Vault: invalid usdgAmount");

        updateCumulativeFundingRate(_token);

        uint256 price = getMaxPrice(_token);

        uint256 tokenAmount = usdgAmount.mul(PRICE_PRECISION).div(price);
        // cap the redemption amount for non-stable tokens
        if (!stableTokens[_token]) {
            uint256 redemptionAmount = getRedemptionAmount(_token, usdgAmount);
            if (tokenAmount > redemptionAmount) {
                tokenAmount = redemptionAmount;
            }
        }

        _decreaseUsdgAmount(_token, usdgAmount);
        _decreasePoolAmount(_token, tokenAmount);

        IUSDG(usdg).burn(address(this), usdgAmount);

        uint256 amountAfterFees = _collectSwapFees(_token, tokenAmount);
        _transferOut(_token, amountAfterFees, _receiver);
    }

    function swap(address _tokenIn, address _tokenOut, address _receiver) external nonReentrant {
        require(whitelistedTokens[_tokenIn], "Vault: _tokenIn not whitelisted");
        require(whitelistedTokens[_tokenOut], "Vault: _tokenOut not whitelisted");
        updateCumulativeFundingRate(_tokenIn);
        updateCumulativeFundingRate(_tokenOut);

        uint256 amountIn = _transferIn(_tokenIn);
        require(amountIn > 0, "Vault: invalid amountIn");

        uint256 amountOut = getSwapAmountOut(_tokenIn, _tokenOut, amountIn);
        uint256 amountAfterFees = _collectSwapFees(_tokenOut, amountOut);

        _increaseUsdgAmount(_tokenIn, amountIn);
        _decreaseUsdgAmount(_tokenOut, amountOut);

        _increasePoolAmount(_tokenIn, amountIn);
        _decreasePoolAmount(_tokenOut, amountOut);

        _transferOut(_tokenOut, amountAfterFees, _receiver);
    }

    function increasePosition(address _collateralToken, address _indexToken, uint256 _size, bool _isLong) external nonReentrant {
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
        uint256 collateral = _transferIn(_collateralToken);

        position.collateral = position.collateral.add(tokenToUsdMin(_collateralToken, collateral)).sub(fee);
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];
        position.size = position.size.add(_size);

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        _validateCollateral(position.size, position.collateral, hasProfit, delta);

        if (_isLong) {
            // for longs, the _indexToken is reserved to pay the position's profits
            _increaseReservedAmount(_indexToken, usdToTokenMax(_indexToken, _size));
            _increaseGuaranteedUsd(_indexToken, _size);
        } else {
            // for shorts, the _collateralToken is reserved to pay the position's profits
            _increaseReservedAmount(_collateralToken, usdToTokenMax(_collateralToken, _size));
        }
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
        // get the proportional change in PnL
        uint256 adjustedDelta = _size.mul(delta).div(position.size);
        uint256 amountOut;

        if (hasProfit) {
            amountOut = adjustedDelta;
        } else {
            position.collateral = position.collateral.sub(adjustedDelta);
        }

        if (_collateral > 0) {
            position.collateral = position.collateral.sub(_collateral);
        }

        position.collateral = position.collateral.sub(fee);
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];
        position.size = position.size.sub(_size);

        _validateCollateral(position.size, position.collateral, hasProfit, delta);

        reservedAmounts[_collateralToken] = reservedAmounts[_collateralToken].sub(_collateral);
        reservedAmounts[_indexToken] = reservedAmounts[_indexToken].sub(usdToTokenMax(_indexToken, _size));
        guaranteedUsd[_indexToken] = guaranteedUsd[_indexToken].add(usdToTokenMin(_indexToken, _size));

        if (_isLong) {
            _decreaseReservedAmount(_indexToken, usdToTokenMax(_indexToken, _size));
            _decreaseGuaranteedUsd(_indexToken, _size);
        } else {
            _decreaseReservedAmount(_collateralToken, usdToTokenMax(_collateralToken, _size));
        }

        if (amountOut > 0) { _transferOut(_collateralToken, amountOut, msg.sender); }
    }

    function depositCollateral(address _collateralToken, address _indexToken, bool _isLong) external nonReentrant {
        uint256 collateral = _transferIn(_collateralToken);
        require(collateral > 0, "Vault: invalid collateral");

        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];

        _collectMarginFees(_collateralToken, 0, position.size, position.entryFundingRate);

        position.collateral = position.collateral.add(usdToTokenMin(_collateralToken, collateral));
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];

        (bool hasProfit, uint256 delta) = getDelta(_indexToken, position.size, position.averagePrice, _isLong);
        _validateCollateral(position.size, position.collateral, hasProfit, delta);
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
        _validateCollateral(position.size, position.collateral, hasProfit, delta);
    }

    function liquidatePosition(address _account, address _collateralToken, address _indexToken, bool _isLong, address _feeReceiver) external nonReentrant {
        _validateTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);
        _liquidatePosition(_account, _collateralToken, _indexToken, _isLong, _feeReceiver);
    }

    function getMaxPrice(address _token) public view returns (uint256) {
        return getPrice(_token, true);
    }

    function getMinPrice(address _token) public view returns (uint256) {
        return getPrice(_token, false);
    }

    function getPrice(address _token, bool _maximise) public view returns (uint256) {
        address priceFeedAddress = priceFeeds[_token];
        require(priceFeedAddress != address(0), "Vault: invalid price feed");
        IPriceFeed priceFeed = IPriceFeed(priceFeedAddress);

        uint256 price = 0;
        uint80 roundId = priceFeed.latestRound();

        for (uint80 i = 0; i < priceSampleSpace; i++) {
            if (roundId < i) { break; }
            if (roundId - i == 0) { continue; }
            (, int256 p, , ,) = priceFeed.getRoundData(roundId - i);
            require(p > 0, "Vault: invalid price");

            if (price == 0) {
                price = uint256(p);
                continue;
            }

            if (_maximise && uint256(p) > price) {
                price = uint256(p);
            }

            if (!_maximise && uint256(p) < price) {
                price = uint256(p);
            }
        }

        require(price > 0, "Vault: could not fetch price");
        // normalise price precision
        return price.mul(PRICE_PRECISION).div(getPricePrecision(_token));
    }

    function getPricePrecision(address _token) public view returns (uint256) {
        uint256 decimals = priceDecimals[_token];
        require(decimals > 0, "Vault: invalid price decimals");
        return 10 ** decimals;
    }

    function getRedemptionAmount(address _token, uint256 _usdgAmount) public view returns (uint256) {
        uint256 tokenBalance = usdToTokenMin(_token, guaranteedUsd[_token]);
        tokenBalance = tokenBalance.add(poolAmounts[_token]);
        tokenBalance = tokenBalance.sub(reservedAmounts[_token]);

        uint256 basisPoints = getRedemptionBasisPoints(_token);
        uint256 totalUsdgAmount = usdgAmounts[_token];
        require(totalUsdgAmount > 0, "Vault: invalid totalUsdgAmount");

        uint256 redemptionAmount = _usdgAmount.mul(tokenBalance).div(totalUsdgAmount);
        redemptionAmount = redemptionAmount.mul(basisPoints).div(BASIS_POINTS_DIVISOR);

        return adjustForDecimals(redemptionAmount, usdg, _token);
    }

    function getRedemptionBasisPoints(address _token) public view returns (uint256) {
        uint256 basisPoints = redemptionBasisPoints[_token];
        require(basisPoints > 0, "Vault: invalid redemption basis points");
        return basisPoints;
    }

    function getSwapAmountOut(address _tokenIn, address _tokenOut, uint256 _amountIn) public view returns (uint256) {
        uint256 priceIn = getMinPrice(_tokenIn);
        uint256 priceOut = getMaxPrice(_tokenOut);

        uint256 amount = _amountIn.mul(priceIn).div(priceOut);
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

    function tokenToUsdMax(address _token, uint256 _tokenAmount) public view returns (uint256) {
        if (_tokenAmount == 0) { return 0; }
        uint256 price = getMinPrice(_token);
        return _tokenAmount.mul(price);
    }

    function tokenToUsdMin(address _token, uint256 _tokenAmount) public view returns (uint256) {
        if (_tokenAmount == 0) { return 0; }
        uint256 price = getMaxPrice(_token);
        return _tokenAmount.mul(price);
    }

    function usdToTokenMax(address _token, uint256 _usdAmount) public view returns (uint256) {
        if (_usdAmount == 0) { return 0; }
        uint256 price = getMinPrice(_token);
        return _usdAmount.div(price);
    }

    function usdToTokenMin(address _token, uint256 _usdAmount) public view returns (uint256) {
        if (_usdAmount == 0) { return 0; }
        uint256 price = getMaxPrice(_token);
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
        if (lastFundingTimes[_token] == 0) {
            lastFundingTimes[_token] = block.timestamp.div(fundingInterval).mul(fundingInterval);
            return;
        }

        if (lastFundingTimes[_token].add(fundingInterval) > block.timestamp) {
            return;
        }

        uint256 fundingRate = getNextFundingRate(_token);
        cumulativeFundingRates[_token] = cumulativeFundingRates[_token].add(fundingRate);
        lastFundingTimes[_token] = block.timestamp.div(fundingInterval).mul(fundingInterval);
    }

    function getNextFundingRate(address _token) public view returns (uint256) {
        if (lastFundingTimes[_token].add(fundingInterval) > block.timestamp) {
            return 0;
        }

        uint256 intervals = block.timestamp.sub(lastFundingTimes[_token]).div(fundingInterval);
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance == 0) {
            return 0;
        }
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

        if (_isLong) {
            _decreaseReservedAmount(_indexToken, usdToTokenMax(_indexToken, position.size));
            _decreaseGuaranteedUsd(_indexToken, position.size);
        } else {
            _decreaseReservedAmount(_collateralToken, usdToTokenMax(_collateralToken, position.size));
        }

        feeReserves[_collateralToken] = feeReserves[_collateralToken].add(usdToTokenMin(_collateralToken, fundingFee));
        delete positions[key];

        _transferOut(_collateralToken, usdToTokenMin(_collateralToken, liquidationFeeUsd), _feeReceiver);
    }

    function _validateCollateral(uint256 _size, uint256 _collateral, bool _hasProfit, uint256 _delta) private view {
        if (!_hasProfit && _delta >= _collateral) {
            revert("Vault: position should be liquidated");
        }
        uint256 remainingCollateral = _hasProfit ? _collateral.add(_delta) : _collateral.sub(_delta);
        require(_size.div(remainingCollateral).mul(BASIS_POINTS_DIVISOR) <= maxLeverage, "Vault: maxLeverage exceeded");
        require(_collateral > liquidationFeeUsd, "Vault: insufficient collateral");
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
        uint256 afterFeeAmount = _amount.mul(BASIS_POINTS_DIVISOR.sub(swapFeeBasisPoints)).div(BASIS_POINTS_DIVISOR);
        uint256 feeAmount = _amount.sub(afterFeeAmount);
        feeReserves[_token] = feeReserves[_token].add(feeAmount);
        return afterFeeAmount;
    }

    function _collectMarginFees(address _token, uint256 _size, uint256 _positionSize, uint256 _entryFundingRate) private returns (uint256) {
        uint256 feeUsd = _size.mul(marginFeeBasisPoints).div(BASIS_POINTS_DIVISOR);
        uint256 fundingFee = getFundingFee(_token, _positionSize, _entryFundingRate);
        feeUsd = feeUsd.add(fundingFee);

        uint256 feeTokens = usdToTokenMax(_token, feeUsd);
        feeReserves[_token] = feeReserves[_token].add(feeTokens);

        return feeUsd;
    }

    function _transferIn(address _token) private returns (uint256) {
        uint256 prevBalance = tokenBalances[_token];
        uint256 nextBalance = IERC20(_token).balanceOf(address(this));
        tokenBalances[_token] = nextBalance;

        return nextBalance.sub(prevBalance);
    }

    function _transferOut(address _token, uint256 _amount, address _receiver) private {
        IERC20(_token).safeTransfer(_receiver, _amount);

        uint256 nextBalance = IERC20(_token).balanceOf(address(this));
        require(nextBalance >= reservedAmounts[_token], "Vault: reserve limit exceeded");

        tokenBalances[_token] = nextBalance;
    }

    function _increasePoolAmount(address _token, uint256 _amount) private {
        poolAmounts[_token] = poolAmounts[_token].add(_amount);
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(poolAmounts[_token] <= balance, "Vault: invalid increase");
    }

    function _decreasePoolAmount(address _token, uint256 _amount) private {
        poolAmounts[_token] = poolAmounts[_token].sub(_amount);
        require(reservedAmounts[_token] <= poolAmounts[_token], "Vault: insufficient poolAmount");
    }

    function _increaseUsdgAmount(address _token, uint256 _amount) private {
        usdgAmounts[_token] = usdgAmounts[_token].add(_amount);
    }

    function _decreaseUsdgAmount(address _token, uint256 _amount) private {
        uint256 value = usdgAmounts[_token];
        if (value <= _amount) {
            usdgAmounts[_token] = 0;
            return;
        }
        usdgAmounts[_token] = value.sub(_amount);
    }

    function _increaseReservedAmount(address _token, uint256 _amount) private {
        reservedAmounts[_token] = reservedAmounts[_token].add(_amount);
        require(reservedAmounts[_token] <= poolAmounts[_token], "Vault: insufficient poolAmount");
    }

    function _decreaseReservedAmount(address _token, uint256 _amount) private {
        uint256 value = reservedAmounts[_token];
        if (value <= _amount) {
            reservedAmounts[_token] = 0;
            return;
        }
        reservedAmounts[_token] = value.sub(_amount);
    }

    function _increaseGuaranteedUsd(address _token, uint256 _usdAmount) private {
        guaranteedUsd[_token] = guaranteedUsd[_token].add(_usdAmount);
    }

    function _decreaseGuaranteedUsd(address _token, uint256 _usdAmount) private {
        uint256 value = guaranteedUsd[_token];
        if (value <= _usdAmount) {
            guaranteedUsd[_token] = 0;
            return;
        }
        guaranteedUsd[_token] = value.sub(_usdAmount);
    }
}
