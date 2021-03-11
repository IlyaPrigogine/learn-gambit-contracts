// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "./interfaces/IGUSD.sol";

contract GUSD is IERC20, IGUSD {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    string public constant name = "Gambit USD";
    string public constant symbol = "gUSD";
    uint8 public constant decimals = 18;

    uint256 public override totalSupply;

    address public gov;
    address public vault;

    mapping (address => uint256) public balances;
    mapping (address => mapping (address => uint256)) public allowances;

    modifier onlyGov() {
        require(msg.sender == gov, "GUSD: forbidden");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "GUSD: forbidden");
        _;
    }

    constructor(address _vault) public {
        gov = msg.sender;
        vault = _vault;
    }

    function setGov(address _gov) external onlyGov {
        gov = _gov;
    }

    function mint(address _account, uint256 _amount) external override onlyVault {
        _mint(_account, _amount);
    }

    function burn(address _account, uint256 _amount) external override onlyVault {
        _burn(_account, _amount);
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function balanceOf(address _account) external view override returns (uint256) {
        return balances[_account];
    }

    function transfer(address _recipient, uint256 _amount) external override returns (bool) {
        _transfer(msg.sender, _recipient, _amount);
        return true;
    }

    function allowance(address _owner, address _spender) external view override returns (uint256) {
        return allowances[_owner][_spender];
    }

    function approve(address _spender, uint256 _amount) external override returns (bool) {
        _approve(msg.sender, _spender, _amount);
        return true;
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external override returns (bool) {
        uint256 nextAllowance = allowances[_sender][msg.sender].sub(_amount, "GUSD: transfer amount exceeds allowance");
        _approve(_sender, msg.sender, nextAllowance);
        _transfer(_sender, _recipient, _amount);
        return true;
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(_sender != address(0), "GUSD: transfer from the zero address");
        require(_recipient != address(0), "GUSD: transfer to the zero address");

        balances[_sender] = balances[_sender].sub(_amount, "GUSD: transfer amount exceeds balance");
        balances[_recipient] = balances[_recipient].add(_amount);

        emit Transfer(_sender, _recipient,_amount);
    }

    function _mint(address _account, uint256 _amount) private {
        require(_account != address(0), "GUSD: mint to the zero address");

        totalSupply = totalSupply.add(_amount);
        balances[_account] = balances[_account].add(_amount);

        emit Transfer(address(0), _account, _amount);
    }

    function _burn(address _account, uint256 _amount) private {
        require(_account != address(0), "GUSD: burn from the zero address");

        totalSupply = totalSupply.sub(_amount);
        balances[_account] = balances[_account].sub(_amount);

        emit Transfer(_account, address(0), _amount);
    }

    function _approve(address _owner, address _spender, uint256 _amount) private {
        require(_owner != address(0), "GUSD: approve from the zero address");
        require(_spender != address(0), "GUSD: approve to the zero address");

        allowances[_owner][_spender] = _amount;

        emit Approval(_owner, _spender, _amount);
    }
}
