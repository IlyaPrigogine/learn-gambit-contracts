// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IDistributor {
    function getRewardToken(address _receiver) external view returns (address);
    function distribute() external returns (uint256);
}
