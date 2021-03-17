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
        uint256 qty;
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

    function updatePosition(address _collateralToken, address _indexToken, uint256 _collateral, uint256 _size, bool _isLong) external nonReentrant {
        _validatePositionTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];

        require(position.size != _size, "Vault: position is unchanged");

        bool isBuying = _size > position.size;
        uint256 sizeDelta = isBuying ? _size.sub(position.size) : position.size.sub(_size);
        uint256 price = _isLong ? getMaxPrice(_indexToken) : getMinPrice(_indexToken);

        uint256 qtyDelta = sizeDelta.div(price);
        position.qty = isBuying ? position.qty.add(qtyDelta) : position.qty.sub(qtyDelta);
        position.averagePrice = _size.div(position.qty);
        position.size = _size;
        position.entryFundingRate = cumulativeFundingRates[_collateralToken];

        // TODO: handle PnL, funding rate and fees
        updateCollateral(_collateralToken, _indexToken, _collateral, _isLong);
    }

    function updateCollateral(address _collateralToken, address _indexToken, uint256 _collateral, bool _isLong) public nonReentrant {
        _validatePositionTokens(_collateralToken, _indexToken, _isLong);
        updateCumulativeFundingRate(_collateralToken);

        bytes32 key = getPositionKey(msg.sender, _collateralToken, _indexToken, _isLong);
        Position storage position = positions[key];

        if (position.collateral == _collateral) {
            return;
        }

        if (_collateral > position.collateral) {
            uint256 delta = _collateral.sub(position.collateral);
            _transferIn(_collateralToken, usdToTokenMax(_collateralToken, delta));
        } else {
            uint256 delta = position.collateral.sub(_collateral);
            _transferOut(_collateralToken, usdToTokenMin(_collateralToken, delta), msg.sender);
        }

        position.collateral = _collateral;

        // TODO: validate collateral amount, leverage
    }


    function getLiquidationFee(address _token) public view returns (uint256) {
        uint256 pricePrecision = getPricePrecision(_token);
        return usdToTokenMin(_token, liquidationFeeUsd.mul(pricePrecision));
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

    // _indexToken is intentionally not enforced to be a whitelisted token for shorts
    // it just needs to have a valid priceFeed
    // this adds flexbility by allowing shorting on non-whitelisted tokens
    function _validatePositionTokens(address _collateralToken, address _indexToken, bool _isLong) private view {
        require(whitelistedTokens[_collateralToken], "Vault: _collateralToken not whitelisted");
        if (_isLong) {
            require(_collateralToken == _indexToken, "Vault: mismatched tokens");
        }
    }

    function _collectSwapFees(address _token, uint256 _amount) private returns (uint256) {
        uint256 feeAmount = _amount.mul(swapFeeBasisPoints).div(BASIS_POINTS_DIVISOR);
        feeReserves[_token] = feeReserves[_token].add(feeAmount);
        return _amount.sub(feeAmount);
    }

    function _collectMarginFees(address _token, uint256 _amount, uint256 _leverage) private returns (uint256) {
        uint256 feeAmount = _amount.mul(marginFeeBasisPoints).mul(_leverage).div(BASIS_POINTS_DIVISOR).div(BASIS_POINTS_DIVISOR);
        feeReserves[_token] = feeReserves[_token].add(feeAmount);
        return _amount.sub(feeAmount);
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
}
