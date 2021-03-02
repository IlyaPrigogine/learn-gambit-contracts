// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/token/IERC20.sol";
import "../libraries/math/SafeMath.sol";

contract BatchSender {
    using SafeMath for uint256;

    function send(IERC20 _token, address[] memory _accounts, uint256[] memory _amounts) public {
        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            uint256 amount = _amounts[i];
            _token.transferFrom(msg.sender, account, amount);
        }
    }
}
