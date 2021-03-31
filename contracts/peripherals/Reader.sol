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
            balances[i] = IERC20(_tokens[i]).balanceOf(_account);
        }
        return balances;
    }

    function getVaultTokenInfo(address _vault, address[] memory _tokens, uint256 usdgAmount) public view returns (uint256[] memory) {
        uint256 propsLength = 6;
        IVault vault = IVault(_vault);

        uint256[] memory amounts = new uint256[](_tokens.length * propsLength);
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            amounts[i * propsLength] = vault.poolAmounts(token);
            amounts[i * propsLength + 1] = vault.reservedAmounts(token);
            amounts[i * propsLength + 2] = vault.usdgAmounts(token);
            amounts[i * propsLength + 3] = vault.getRedemptionAmount(token, usdgAmount);
            amounts[i * propsLength + 4] = vault.getMinPrice(token);
            amounts[i * propsLength + 5] = vault.getMaxPrice(token);
        }

        return amounts;
    }
}
