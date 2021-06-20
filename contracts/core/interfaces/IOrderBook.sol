// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IOrderBook {
	function getSwapOrder(address _account, uint256 _orderIndex) external view returns (
        address, 
        address,
        address,
        uint256,
        uint256,
        uint256,
        bool
    );
}