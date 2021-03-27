// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/IUSDG.sol";
import "./YieldToken.sol";

contract USDG is YieldToken, IUSDG {

    address public vault;

    modifier onlyVault() {
        require(msg.sender == vault, "USDG: forbidden");
        _;
    }

    constructor(address _vault) public YieldToken("USD Gambit", "USDG", 0) {
        vault = _vault;
    }

    function mint(address _account, uint256 _amount) external override onlyVault {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external override onlyVault {
        _burn(_account, _amount);
    }
}
