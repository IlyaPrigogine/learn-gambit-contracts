// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";

import "../core/OrderBook.sol";

import "hardhat/console.sol";

contract OrderBookReader {
    using SafeMath for uint256;

    // TODO support `indices` arg instead of `from` and `to`
    function getSwapOrders(
        address payable _orderBookAddress, 
        address _account,
        uint256 _fromIndex, 
        uint256 _toIndex
    ) external view returns (uint256[] memory) {
        uint256[] memory ret = new uint256[]((_toIndex - _fromIndex) * 8);
        // TODO use IOrderBook
        OrderBook orderBook = OrderBook(_orderBookAddress);

        // avoiding stack too deep... weird
        // TODO is there more adequate way?
        uint256 i = 0;
        while (_toIndex > _fromIndex) {
            _toIndex--;

            // TODO skip empty orders
            (
                address path0,
                address path1,
                address path2,
                uint256 amountIn, 
                uint256 minOut, 
                uint256 triggerRatio, 
                bool triggerAboveThreshold
            ) = orderBook.getSwapOrder(_account, _toIndex);

            // TODO is there a way to not to use uint256 only?
            ret[i * 8] = uint256(path0);
            ret[i * 8 + 1] = uint256(path1);
            ret[i * 8 + 2] = uint256(path2);
            ret[i * 8 + 3] = uint256(amountIn);
            ret[i * 8 + 4] = uint256(minOut);
            ret[i * 8 + 5] = uint256(triggerRatio);
            ret[i * 8 + 6] = uint256(triggerAboveThreshold ? 1 : 0);
            ret[i * 8 + 7] = uint256(_toIndex);

            i++;
        }

        return ret;
    }
}
