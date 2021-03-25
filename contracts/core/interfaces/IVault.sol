// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IVault {
    function buyUSDG(address _token, address _receiver) external returns (uint256);
    function sellUSDG(address _token, address _receiver) external returns (uint256);
    function swap(address _tokenIn, address _tokenOut, address _receiver) external returns (uint256);
}
