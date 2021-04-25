// SPDX-License-Identifier: MIT

import "../libraries/math/SafeMath.sol";

import "./interfaces/IVaultPriceFeed.sol";
import "../oracle/interfaces/IPriceFeed.sol";

pragma solidity 0.6.12;

contract VaultPriceFeed is IVaultPriceFeed {
    using SafeMath for uint256;

    uint256 public constant PRICE_PRECISION = 10 ** 30;
    uint256 public constant ONE_USD = PRICE_PRECISION;

    address public gov;
    uint256 public priceSampleSpace = 3;
    uint256 public maxStrictPriceDeviation = 0;

    mapping (address => address) public priceFeeds;
    mapping (address => uint256) public priceDecimals;
    // Chainlink can return prices for stablecoins
    // that differs from 1 USD by a larger percentage than stableSwapFeeBasisPoints
    // we use strictStableTokens to cap the price to 1 USD
    // this allows us to configure stablecoins like DAI as being a stableToken
    // while not being a strictStableToken
    mapping (address => bool) public strictStableTokens;

    modifier onlyGov() {
        require(msg.sender == gov, "AmmPriceFeed: forbidden");
        _;
    }

    constructor() public {
        gov = msg.sender;
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }

    function setPriceSampleSpace(uint256 _priceSampleSpace) external override onlyGov {
        require(_priceSampleSpace > 0, "VaultPriceFeed: invalid _priceSampleSpace");
        priceSampleSpace = _priceSampleSpace;
    }

    function setMaxStrictPriceDeviation(uint256 _maxStrictPriceDeviation) external override onlyGov {
        maxStrictPriceDeviation = _maxStrictPriceDeviation;
    }

    function setPriceFeed(
        address _token,
        address _priceFeed,
        uint256 _priceDecimals,
        bool _isStrictStable
    ) external override onlyGov {
        priceFeeds[_token] = _priceFeed;
        priceDecimals[_token] = _priceDecimals;
        strictStableTokens[_token] = _isStrictStable;
    }

    function getPrice(address _token, bool _maximise, bool _includeAmmPrice) public override view returns (uint256) {
        address priceFeedAddress = priceFeeds[_token];
        require(priceFeedAddress != address(0), "VaultPriceFeed: invalid price feed");
        IPriceFeed priceFeed = IPriceFeed(priceFeedAddress);

        uint256 price = 0;
        uint80 roundId = priceFeed.latestRound();

        for (uint80 i = 0; i < priceSampleSpace; i++) {
            if (roundId <= i) { break; }
            uint256 p;

            if (i == 0) {
                int256 _p = priceFeed.latestAnswer();
                require(_p > 0, "VaultPriceFeed: invalid price");
                p = uint256(_p);
            } else {
                (, int256 _p, , ,) = priceFeed.getRoundData(roundId - i);
                require(_p > 0, "VaultPriceFeed: invalid price");
                p = uint256(_p);
            }

            if (price == 0) {
                price = p;
                continue;
            }

            if (_maximise && p > price) {
                price = p;
                continue;
            }

            if (!_maximise && p < price) {
                price = p;
            }
        }

        require(price > 0, "VaultPriceFeed: could not fetch price");
        // normalise price precision
        uint256 _priceDecimals = priceDecimals[_token];
        price = price.mul(PRICE_PRECISION).div(10 ** _priceDecimals);

        if (_includeAmmPrice) {
            uint256 ammPrice = getAmmPrice(_token);
            if (ammPrice > 0) {
                if (_maximise && ammPrice > price) {
                    price = ammPrice;
                }
                if (!_maximise && ammPrice < price) {
                    price = ammPrice;
                }
            }
        }

        if (strictStableTokens[_token]) {
            uint256 delta = price > ONE_USD ? price.sub(ONE_USD) : ONE_USD.sub(price);
            if (delta <= maxStrictPriceDeviation) {
                return ONE_USD;
            }
        }

        return price;
    }

    function getAmmPrice(address /* _token */) public override view returns (uint256) {
        return 0;
    }
}
