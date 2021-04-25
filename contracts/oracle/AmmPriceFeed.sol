// SPDX-License-Identifier: MIT

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IVault.sol";
import "../amm/interfaces/IPancakeFactory.sol";

import "./interfaces/IAmmPriceFeed.sol";

pragma solidity 0.6.12;

contract AmmPriceFeed is IAmmPriceFeed {
    using SafeMath for uint256;

    uint256 constant PRICE_PRECISION = 10 ** 30;

    address public gov;
    bool public isInitialized;
    bool public isEnabled = true;

    address public vault;
    address public factory;

    address public btc;
    address public eth;
    address public bnb;
    address public busd;

    modifier onlyGov() {
        require(msg.sender == gov, "AmmPriceFeed: forbidden");
        _;
    }

    constructor() public {
        gov = msg.sender;
    }

    function initialize(address[] memory _addresses) external onlyGov {
        require(!isInitialized, "AmmPriceFeed: already initialized");
        isInitialized = true;

        vault = _addresses[0];
        factory = _addresses[1];

        btc = _addresses[2];
        eth = _addresses[3];
        bnb = _addresses[4];
        busd = _addresses[5];
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }

    function setFactory(address _factory) external onlyGov {
        factory = _factory;
    }

    function setIsEnabled(bool _isEnabled) external onlyGov {
        isEnabled = _isEnabled;
    }

    function getPrice(address _token) external override view returns (uint256) {
        if (!isEnabled) {
            return 0;
        }

        if (_token == btc) {
            return getPriceFromPath(busd, bnb, btc);
        }

        if (_token == eth) {
            return getPriceFromPath(busd, bnb, eth);
        }

        if (_token == bnb) {
            return getPriceFromPath(busd, bnb);
        }

        return 0;
    }

    function getPriceFromPath(address _token0, address _token1, address _token2) public view returns (uint256) {
        uint256 price0 = getPriceFromPath(_token0, _token1);
        uint256 price1 = getPriceFromPath(_token1, _token2);

        // this calculation could overflow if (price0 / 10**30) * (price1 / 10**30) is more than 10**17
        return price0.mul(price1).div(PRICE_PRECISION);
    }

    function getPriceFromPath(address _token0, address _token1) public view returns (uint256) {
        address pair = IPancakeFactory(factory).getPair(_token0, _token1);

        uint256 balance0 = IERC20(_token0).balanceOf(pair);
        uint256 balance1 = IERC20(_token1).balanceOf(pair);

        if (balance0 == 0 || balance1 == 0) {
            return 0;
        }

        uint256 decimals0 = IVault(vault).tokenDecimals(_token0);
        uint256 decimals1 = IVault(vault).tokenDecimals(_token1);

        uint256 price = balance0.mul(10 ** decimals1).mul(PRICE_PRECISION);
        price = price.div(balance1).div(10 ** decimals0);

        return price;
    }
}
