// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IAmmPriceFeed {
    function getPrice(address _token) external view returns (uint256);
}
