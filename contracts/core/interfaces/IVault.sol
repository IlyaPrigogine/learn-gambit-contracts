// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IVault {
    function buyUSDG(address _token, address _receiver) external returns (uint256);
    function sellUSDG(address _token, address _receiver) external returns (uint256);
    function swap(address _tokenIn, address _tokenOut, address _receiver) external returns (uint256);
    function increasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong) external;
    function decreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver) external returns (uint256);
    function getMaxPrice(address _token) external view returns (uint256);
    function getMinPrice(address _token) external view returns (uint256);
    function getSinglePrice(address _token) external view returns (uint256);
    function getRoundId(address _token) external view returns (uint256);
    function getRoundPrice(address _token, uint256 _roundId) external view returns (uint256);
}
