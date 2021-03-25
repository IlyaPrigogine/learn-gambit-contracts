
// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";

import "../tokens/interfaces/IWETH.sol";
import "./interfaces/IVault.sol";

contract Router {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // wrapped BNB / ETH
    address public weth;
    address public usdg;
    address public vault;

    constructor(address _weth, address _usdg, address _vault) public {
        weth = _weth;
        usdg = _usdg;
        vault = _vault;
    }

    receive() external payable {}

    function swap(address _tokenIn, address _tokenOut, uint256 _amountIn, uint256 _minOut, address _receiver) external payable {
        IERC20(_tokenIn).safeTransferFrom(msg.sender, vault, _amountIn);
        _swap(_tokenIn, _tokenOut, _minOut, _receiver);
    }

    function swapETHToTokens(address _tokenOut, uint256 _minOut, address _receiver) external payable {
        _transferETHToVault();
        _swap(weth, _tokenOut, _minOut, _receiver);
    }

    function swapTokensToETH(address _tokenIn, uint256 _amountIn, uint256 _minOut, address _receiver) external {
        IERC20(_tokenIn).safeTransferFrom(msg.sender, vault, _amountIn);
        uint256 amountOut = _swap(_tokenIn, weth, _minOut, address(this));
        _transferOutETH(amountOut, _receiver);
    }

    function multiSwap(address _tokenIn, address _tokenMid, address _tokenOut, uint256 _amountIn, uint256 _minOut, address _receiver) external {
        IERC20(_tokenIn).safeTransferFrom(msg.sender, vault, _amountIn);
        _swap(_tokenIn, _tokenMid, type(uint256).max, vault);
        _swap(_tokenMid, _tokenOut, _minOut, _receiver);
    }

    function multiSwapEthToTokens(address _tokenMid, address _tokenOut, uint256 _minOut, address _receiver) external payable {
        _transferETHToVault();
        _swap(weth, _tokenMid, type(uint256).max, vault);
        _swap(_tokenMid, _tokenOut, _minOut, _receiver);
    }

    function multiSwapTokensToETH(address _tokenIn, address _tokenMid, uint256 _amountIn, uint256 _minOut, address _receiver) external payable {
        IERC20(_tokenIn).safeTransferFrom(msg.sender, vault, _amountIn);
        _swap(_tokenIn, _tokenMid, type(uint256).max, vault);
        uint256 amountOut = _swap(_tokenMid, weth, _minOut, address(this));
        _transferOutETH(amountOut, _receiver);
    }

    function _transferETHToVault() private {
        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).safeTransfer(vault, msg.value);
    }

    function _transferOutETH(uint256 _amountOut, address _receiver) private {
        IWETH(weth).withdraw(_amountOut);
        IERC20(weth).safeTransfer(_receiver, _amountOut);
    }

    function _swap(address _tokenIn, address _tokenOut, uint256 _minOut, address _receiver) private returns (uint256) {
        uint256 amountOut;

        if (_tokenOut == usdg) { // buyUSDG
            amountOut = IVault(vault).buyUSDG(_tokenIn, _receiver);
        } else if (_tokenIn == usdg) { // sellUSDG
            amountOut = IVault(vault).sellUSDG(_tokenOut, _receiver);
        } else { // swap
            amountOut = IVault(vault).swap(_tokenIn, _tokenOut, _receiver);
        }

        require(amountOut >= _minOut, "Router: insufficient amountOut");
        return amountOut;
    }
}
