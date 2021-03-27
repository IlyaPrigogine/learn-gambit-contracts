// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IYieldTracker {
    function claim(address _account, address _receiver) external returns (uint256);
    function updateRewards(address _account) external;
}
