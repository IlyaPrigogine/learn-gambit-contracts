// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";

import "../amm/interfaces/IPancakeRouter.sol";

contract Treasury is ReentrancyGuard {
    using SafeMath for uint256;

    uint256 constant PRECISION = 1000000;
    uint256 constant BASIS_POINTS_DIVISOR = 10000;

    bool public isInitialized;
    bool public isSwapActive = true;

    address public gmt;
    address public busd;
    address public router;
    address public fund;

    uint256 public gmtPrice;
    uint256 public maxBusdAmount;
    uint256 public busdHardcap;
    uint256 public busdBasisPoints;
    uint256 public unlockTime;

    uint256 public busdReceived;

    address public gov;

    mapping (address => uint256) public swapAmounts;
    mapping (address => bool) public swapWhitelist;

    modifier onlyGov() {
        require(msg.sender == gov, "Treasury: forbidden");
        _;
    }

    constructor() public {
        gov = msg.sender;
    }

    function initialize(
        address[] memory _addresses,
        uint256[] memory _values
    ) external onlyGov {
        require(!isInitialized, "Treasury: already initialized");
        isInitialized = true;

        gmt = _addresses[0];
        busd = _addresses[1];
        router = _addresses[2];
        fund = _addresses[3];

        gmtPrice = _values[0];
        maxBusdAmount = _values[1];
        busdHardcap = _values[2];
        busdBasisPoints = _values[3];
        unlockTime = _values[4];
    }

    function extendUnlockTime(uint256 _unlockTime) external onlyGov nonReentrant {
        unlockTime = _unlockTime;
    }

    function addWhitelists(address[] memory _accounts) external onlyGov nonReentrant {
        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            swapWhitelist[account] = true;
        }
    }

    function removeWhitelists(address[] memory _accounts) external onlyGov nonReentrant {
        for (uint256 i = 0; i < _accounts.length; i++) {
            address account = _accounts[i];
            swapWhitelist[account] = false;
        }
    }

    function updateWhitelist(address prevAccount, address nextAccount) external onlyGov nonReentrant {
        require(swapWhitelist[prevAccount], "Treasury: invalid prevAccount");
        swapWhitelist[prevAccount] = false;
        swapWhitelist[nextAccount] = true;
    }

    function swap(uint256 _busdAmount) external nonReentrant {
        address account = msg.sender;
        require(swapWhitelist[account], "Treasury: forbidden");
        require(isSwapActive, "Treasury: swap is no longer active");
        require(_busdAmount > 0, "Treasury: invalid _busdAmount");

        swapAmounts[account] = swapAmounts[account].add(_busdAmount);
        require(swapAmounts[account] <= maxBusdAmount, "Treasury: maxBusdAmount exceeded");

        busdReceived = busdReceived.add(_busdAmount);
        require(busdReceived <= busdHardcap, "Treasury: busdHardcap exceeded");

        uint256 gmtAmount = _busdAmount.mul(PRECISION).div(gmtPrice);
        // receive BUSD
        IERC20(busd).transferFrom(account, address(this), _busdAmount);
        // send GMT
        IERC20(gmt).transferFrom(address(this), account, gmtAmount);
    }

    function addLiquidity() external onlyGov nonReentrant {
        isSwapActive = false;

        uint256 busdAmount = busdReceived.mul(busdBasisPoints).div(BASIS_POINTS_DIVISOR);
        uint256 gmtAmount = busdAmount.mul(gmtPrice).div(PRECISION);

        IERC20(busd).approve(router, busdAmount);
        IERC20(gmt).approve(router, gmtAmount);

        IPancakeRouter(router).addLiquidity(
            busd, // tokenA
            gmt, // tokenB
            busdAmount, // amountADesired
            gmtAmount, // amountBDesired
            0, // amountAMin
            0, // amountBMin
            address(this), // to
            block.timestamp // deadline
        );

        uint256 fundAmount = busdReceived.sub(busdAmount);
        IERC20(busd).transfer(fund, fundAmount);
    }

    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        require(block.timestamp > unlockTime, "Treasury: unlockTime not yet passed");
        IERC20(_token).transfer(_account, _amount);
    }

    function increaseBusdBasisPoints(uint256 _busdBasisPoints) external onlyGov nonReentrant {
        require(_busdBasisPoints > busdBasisPoints, "Treasury: invalid _busdBasisPoints");
        busdBasisPoints = _busdBasisPoints;
    }

    function endSwap() external onlyGov nonReentrant {
        isSwapActive = false;
    }
}
