// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/token/IERC20.sol";
import "../libraries/math/SafeMath.sol";

import "../core/interfaces/IVault.sol";

contract Reader {
    using SafeMath for uint256;

    function getTokenBalances(address _account, address[] memory _tokens) public view returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](_tokens.length);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                balances[i] = _account.balance;
                continue;
            }
            balances[i] = IERC20(token).balanceOf(_account);
        }
        return balances;
    }

    function getVaultTokenInfo(address _vault, address _weth, uint256 _usdgAmount, address[] memory _tokens) public view returns (uint256[] memory) {
        uint256 propsLength = 6;
        IVault vault = IVault(_vault);
        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            if (token == address(0)) {
                token = _weth;
            }
            amounts[i * propsLength] = vault.poolAmounts(token);
            amounts[i * propsLength + 1] = vault.reservedAmounts(token);
            amounts[i * propsLength + 2] = vault.usdgAmounts(token);
            amounts[i * propsLength + 3] = vault.getRedemptionAmount(token, _usdgAmount);
            amounts[i * propsLength + 4] = vault.getMinPrice(token);
            amounts[i * propsLength + 5] = vault.getMaxPrice(token);
        }

        return amounts;
    }

    function getPositions(address _vault, address _account, address[] memory _collateralTokens, address[] memory _indexTokens, bool[] memory _isLong) public view returns(uint256[] memory) {
        uint256 propsLength = 8;
        uint256[] memory amounts = new uint256[](_collateralTokens.length * propsLength);

        for (uint256 i = 0; i < _collateralTokens.length; i++) {
            {
            (uint256 size,
             uint256 collateral,
             uint256 averagePrice,
             uint256 entryFundingRate,
             /* reserveAmount */,
             uint256 realisedPnl,
             bool hasRealisedProfit) = IVault(_vault).getPosition(_account, _collateralTokens[i], _indexTokens[i], _isLong[i]);

            amounts[i * propsLength] = size;
            amounts[i * propsLength + 1] = collateral;
            amounts[i * propsLength + 2] = averagePrice;
            amounts[i * propsLength + 3] = entryFundingRate;
            amounts[i * propsLength + 4] = hasRealisedProfit ? 1 : 0;
            amounts[i * propsLength + 5] = realisedPnl;
            }

            uint256 size = amounts[i * propsLength];
            uint256 averagePrice = amounts[i * propsLength + 2];
            if (averagePrice > 0) {
                (bool hasProfit, uint256 delta) = IVault(_vault).getDelta(_indexTokens[i], size, averagePrice, _isLong[i]);
                amounts[i * propsLength + 6] = hasProfit ? 1 : 0;
                amounts[i * propsLength + 7] = delta;
            }
        }

        return amounts;
    }
}
