// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";

import "../core/OrderBook.sol";

import "hardhat/console.sol";

contract OrderBookReader {
    using SafeMath for uint256;

    struct Vars {
        uint256 i;
        uint256 index;
        address account;
        uint256 uintLength;
        uint256 addressLength;
    }

    // TODO support `indices` arg instead of `from` and `to`
    function getSwapOrders(
        address payable _orderBookAddress, 
        address _account,
        uint256 _fromIndex, 
        uint256 _toIndex
    ) external view returns (uint256[] memory, address[] memory) {
        Vars memory vars = Vars(0, _toIndex, _account, 5, 3);

        uint256[] memory uintProps = new uint256[](vars.uintLength * (_toIndex - _fromIndex));
        address[] memory addressProps = new address[](vars.addressLength * (_toIndex - _fromIndex));

        // TODO use IOrderBook
        OrderBook orderBook = OrderBook(_orderBookAddress);

        while (vars.index > _fromIndex) {
            vars.index--;
            (
                address path0,
                address path1,
                address path2,
                uint256 amountIn, 
                uint256 minOut, 
                uint256 triggerRatio
                , 
                bool triggerAboveThreshold
            ) = orderBook.getSwapOrder(vars.account, vars.index);

            uintProps[vars.i * vars.uintLength] = uint256(amountIn);
            uintProps[vars.i * vars.uintLength + 1] = uint256(minOut);
            uintProps[vars.i * vars.uintLength + 2] = uint256(triggerRatio);
            uintProps[vars.i * vars.uintLength + 3] = uint256(triggerAboveThreshold ? 1 : 0);
            uintProps[vars.i * vars.uintLength + 4] = uint256(vars.index);

            addressProps[vars.i * vars.addressLength] = (path0);
            addressProps[vars.i * vars.addressLength + 1] = (path1);
            addressProps[vars.i * vars.addressLength + 2] = (path2);

            vars.i++;
        }

        return (uintProps, addressProps);
    }
}
