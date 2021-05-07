const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet, gasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

const BTC_PRICE = 60000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("OrderBook", function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()

    let orderBook;
    let defaults;

    beforeEach(async () => {
        bnb = await deployContract("Token", [])
        bnbPriceFeed = await deployContract("PriceFeed", [])

        btc = await deployContract("Token", [])
        btcPriceFeed = await deployContract("PriceFeed", [])

        eth = await deployContract("Token", [])
        ethPriceFeed = await deployContract("PriceFeed", [])

        dai = await deployContract("Token", [])
        daiPriceFeed = await deployContract("PriceFeed", [])

        busd = await deployContract("Token", [])
        busdPriceFeed = await deployContract("PriceFeed", [])

        vault = await deployContract("Vault", [])
        usdg = await deployContract("USDG", [vault.address])
        router = await deployContract("Router", [vault.address, usdg.address, bnb.address])
        vaultPriceFeed = await deployContract("VaultPriceFeed", [])

        await initVault(vault, router, usdg, vaultPriceFeed)

        distributor0 = await deployContract("TimeDistributor", [])
        yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

        await yieldTracker0.setDistributor(distributor0.address)
        await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

        await bnb.mint(distributor0.address, 5000)
        await usdg.setYieldTrackers([yieldTracker0.address])

        reader = await deployContract("Reader", [])

        await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
        await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

        await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
        await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

        await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE))
        await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

        await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
        await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

        await vault.setIsMintingEnabled(true)

        orderBook = await deployContract("OrderBook", [])
        const executionGasLimit = 100000;
        const gasPrice = 5;
        await orderBook.initialize(
            router.address,
            vault.address,
            bnb.address,
            usdg.address,
            executionGasLimit, 
            gasPrice,
            dai.address
        );

        await router.addPlugin(orderBook.address);
        await router.connect(user0).approvePlugin(orderBook.address);

        await btc.mint(user0.address, expandDecimals(100, 8))
        await btc.connect(user0).approve(router.address, expandDecimals(100, 8))

        await dai.mint(user0.address, expandDecimals(1000000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(1000000, 18))

        await dai.mint(user0.address, expandDecimals(2000000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(2000000, 18))
        await vault.directPoolDeposit(dai.address);

        await btc.mint(user0.address, expandDecimals(100, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(100, 8))
        await vault.directPoolDeposit(btc.address);

        defaults = {
            path: [btc.address],
            sizeDelta: expandDecimals(150000, 30),
            amountIn: expandDecimals(1, 8),
            triggerPrice: expandDecimals(53000, 30),
            triggerAbovePrice: false,
            executionFee: 1000000,
            user: user0,
            isLong: true
        };
    })

    function positionWrapper(position) {
        return {
            size: position[0],
            collateral: position[1],
            averagePrice: position[2],
            entryFundingRate: position[3],
            reserveAmount: position[4]
        };
    }

    function getDefault(obj, name, defaultValue) {
        return (name in obj) ? obj[name] : defaultValue;
    }

    function defaultCreateIncreasePositionOrder(props = {}) {
        return orderBook.connect(getDefault(props, 'user', defaults.user)).createIncreasePositionOrder(
            getDefault(props, 'path', defaults.path),
            getDefault(props, 'amountIn', defaults.amountIn),
            getDefault(props, 'indexToken', defaults.path[defaults.path.length - 1]),
            getDefault(props, 'minOut', 0),
            getDefault(props, 'sizeDelta', defaults.sizeDelta),
            getDefault(props, 'isLong', defaults.isLong),
            getDefault(props, 'triggerPrice', defaults.triggerPrice),
            getDefault(props, 'triggerAbovePrice', defaults.triggerAbovePrice),
            getDefault(props, 'executionFee', defaults.executionFee),
            {value: getDefault(props, 'value', props.executionFee || defaults.executionFee)}
        );
    }

    async function getCreatedOrder(address, orderIndex = 0) {
        const orderKey = await orderBook.getOrderKey(address, orderIndex);
        const order = await orderBook.orders(orderKey);
        return order;
    }

    it("setGov", async () => {
        await expect(orderBook.connect(user0).setGov(user1.address)).to.be.revertedWith("OrderBook: forbidden")

        expect(await orderBook.gov()).eq(wallet.address)

        await orderBook.setGov(user0.address)
        expect(await orderBook.gov()).eq(user0.address)

        await orderBook.connect(user0).setGov(user1.address)
        expect(await orderBook.gov()).eq(user1.address)
    });

    it("initialize, already initialized", async () => {
        await expect(orderBook.connect(user1).initialize(
            router.address,
            vault.address,
            bnb.address,
            usdg.address,
            1, 
            1,
            dai.address
        )).to.be.revertedWith("OrderBook: forbidden");

        await expect(orderBook.initialize(
            router.address,
            vault.address,
            bnb.address,
            usdg.address,
            1, 
            1,
            dai.address
        )).to.be.revertedWith("OrderBook: already initialized");
    });

    it("createIncreasePositionOrder, bad executionFee", async () => {
        const badExecutionFee = 100;
        await expect(defaultCreateIncreasePositionOrder({
            executionFee: badExecutionFee
        })).to.be.revertedWith("OrderBook: insufficient execution fee");

        const goodExecutionFee = expandDecimals(1, 8);
        await expect(defaultCreateIncreasePositionOrder({
            executionFee: goodExecutionFee,
            value: goodExecutionFee - 1
        })).to.be.revertedWith("OrderBook: insufficient execution fee transferred");
    });

    it("cancelOrder", async () => {
        const tokenBalanceBefore = await btc.balanceOf(defaults.user.address);
        await defaultCreateIncreasePositionOrder();

        const orderKey = await orderBook.getOrderKey(defaults.user.address, 0);
        await expect(orderBook.connect(user1).cancelOrder(orderKey)).to.be.revertedWith("OrderBook: forbidden");

        await orderBook.connect(user0).cancelOrder(orderKey);
        // TODO check all/bnb funds with tx receipts? Can't compare before/after directly because of network fees

        const tokenBalanceAfter = await btc.balanceOf(defaults.user.address);
        expect(tokenBalanceAfter, "Before and after token balance are not equal").to.be.equal(tokenBalanceBefore);

        const order = await orderBook.orders(orderKey);
        expect(order.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, non existent order", async () => {
        const orderKey = await orderBook.getOrderKey(user3.address, 0);
        await expect(orderBook.executeOrder(orderKey, user1.address)).to.be.revertedWith("OrderBook: non-existent order key");
    });

    it("executeOrder, current price is invalid", async () => {
        let orderIndex = 0;

        await defaultCreateIncreasePositionOrder({triggerPrice: expandDecimals(BTC_PRICE + 1000, 30)});
        const orderAKey = await orderBook.getOrderKey(defaults.user.address, orderIndex++);
        const orderA = await orderBook.orders(orderAKey);

        await expect(orderBook.executeOrder(orderAKey, user1.address)).to.be.revertedWith("OrderBook: invalid price for execution");

        await defaultCreateIncreasePositionOrder({
            triggerPrice: expandDecimals(BTC_PRICE - 1000, 30),
            isLong: false,
            triggerAbovePrice: true
        });
        const orderBKey = await orderBook.getOrderKey(defaults.user.address, orderIndex++);
        const orderB = await orderBook.orders(orderBKey);
        await expect(orderBook.executeOrder(orderBKey, user1.address)).to.be.revertedWith("OrderBook: invalid price for execution");
    });

    it("executeOrder, long, purchase token same as collateral", async () => {
        await defaultCreateIncreasePositionOrder();

        const orderKey = await orderBook.getOrderKey(defaults.user.address, 0);
        const order = await orderBook.orders(orderKey);

        const executorBalanceBefore = await user1.getBalance();
        await orderBook.executeOrder(orderKey, user1.address);
        const executorBalanceAfter = await user1.getBalance();
        expect(executorBalanceAfter.gt(executorBalanceBefore)).to.be.true

        const position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, defaults.isLong));
        // TODO is it enough to check?
        expect(position.size).to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.orders(orderKey);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, long, swap purchase token to collateral", async () => {
        await defaultCreateIncreasePositionOrder();

        const orderKey = await orderBook.getOrderKey(defaults.user.address, 0);
        const order = await orderBook.orders(orderKey);
        await orderBook.executeOrder(orderKey, user1.address);

        const position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, defaults.isLong));
        // TODO is it enough to check?
        expect(position.size).to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.orders(orderKey);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, short, purchase token same as collateral", async () => {
        dai.mint(user0.address, expandDecimals(50000, 18));
        await defaultCreateIncreasePositionOrder({
            path: [dai.address],
            isLong: false,
            amountIn: expandDecimals(50000, 18),
            triggerAbovePrice: true,
            triggerPrice: expandDecimals(BTC_PRICE + 100, 30)
        });

        const orderKey = await orderBook.getOrderKey(defaults.user.address, 0);
        const order = await orderBook.orders(orderKey);
        await orderBook.executeOrder(orderKey, user1.address);

        const position = positionWrapper(await vault.getPosition(user0.address, dai.address, btc.address, false));
        // TODO is it enough to check?
        expect(position.size, 'position.size').to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.orders(orderKey);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, short, swap purchase token to collateral", async () => {
        await defaultCreateIncreasePositionOrder({
            isLong: false,
            triggerAbovePrice: true,
            triggerPrice: expandDecimals(BTC_PRICE + 100, 30)
        });

        const orderKey = await orderBook.getOrderKey(defaults.user.address, 0);
        const order = await orderBook.orders(orderKey);
        await orderBook.executeOrder(orderKey, user1.address);

        const position = positionWrapper(await vault.getPosition(user0.address, dai.address, btc.address, false));
        // TODO is it enough to check?
        expect(position.size, 'position.size').to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.orders(orderKey);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("createIncreasePositionOrder, bad path", async () => {
        await expect(defaultCreateIncreasePositionOrder({
            path: [btc.address, btc.address]
        })).to.be.revertedWith("OrderBook: invalid _path");
    });

    it("createIncreasePositionOrder, long A, transfer and purchase A", async () => {
        const btcBalanceBefore = await btc.balanceOf(orderBook.address);
        await defaultCreateIncreasePositionOrder();
        const order = await getCreatedOrder(user0.address);
        const btcBalanceAfter = await btc.balanceOf(orderBook.address);

        expect(await bnb.balanceOf(orderBook.address), 'BNB balance').to.be.equal(defaults.executionFee);
        expect(btcBalanceAfter.sub(btcBalanceBefore), 'BTC balance').to.be.equal(defaults.amountIn);

        expect(order.account).to.be.equal(defaults.user.address);
        expect(order.purchaseToken).to.be.equal(btc.address);
        expect(order.purchaseTokenAmount).to.be.equal(defaults.amountIn);
        expect(order.indexToken).to.be.equal(btc.address);
        expect(order.sizeDelta).to.be.equal(defaults.sizeDelta);
        expect(order.isLong).to.be.true;
        expect(order.triggerPrice).to.be.equal(defaults.triggerPrice);
        expect(order.triggerAbovePrice).to.be.false;
        expect(order.isIncrease).to.be.true;
        expect(order.executionFee).to.be.equal(defaults.executionFee);
    });

    it("createIncreasePositionOrder, long A, transfer A, purchase B", async () => {
        const daiBalanceBefore = await dai.balanceOf(orderBook.address);
        await defaultCreateIncreasePositionOrder({
            path: [btc.address, dai.address]
        });
        const daiBalanceAfter = await dai.balanceOf(orderBook.address);
        const order = await getCreatedOrder(defaults.user.address);

        expect(await bnb.balanceOf(orderBook.address), 'BNB balance').to.be.equal(defaults.executionFee);
        // Q: is it ok to compare with gt and compare to *0.98? To consider fees
        expect(daiBalanceAfter.sub(daiBalanceBefore).gt(defaults.amountIn.mul(BTC_PRICE).mul(98).div(100))).to.be.true;

        expect(order.account).to.be.equal(defaults.user.address);
        expect(order.purchaseToken, 'purchaseToken').to.be.equal(dai.address);
        expect(order.purchaseTokenAmount, 'purchaseTokenAmount').to.be.above(expandDecimals(BTC_PRICE * 0.99, 18));
        expect(order.indexToken, 'indexToken').to.be.equal(btc.address);
        expect(order.sizeDelta, 'sizeDelta').to.be.equal(defaults.sizeDelta);
        expect(order.isLong, 'isLong').to.be.true;
        expect(order.triggerPrice, 'triggerPrice').to.be.equal(defaults.triggerPrice);
        expect(order.triggerAbovePrice, 'triggerAbovePrice').to.be.false;
        expect(order.isIncrease, 'isIncrease').to.be.true;
        expect(order.executionFee, 'executionFee').to.be.equal(defaults.executionFee);
    });

    it("createIncreasePositionOrder, short A, transfer B, purchase B", async () => {
        const daiBalanceBefore = await dai.balanceOf(orderBook.address);
        await defaultCreateIncreasePositionOrder({
            path: [dai.address],
            isLong: false,
            triggerAbovePrice: true
        });
        const daiBalanceAfter = await dai.balanceOf(orderBook.address);

        const order = await getCreatedOrder(defaults.user.address);
        expect(await bnb.balanceOf(orderBook.address)).to.be.equal(defaults.executionFee);
        expect(daiBalanceAfter.sub(daiBalanceBefore), 'BTC balance').to.be.equal(defaults.amountIn);

        expect(order.account).to.be.equal(defaults.user.address);
        expect(order.purchaseToken).to.be.equal(dai.address);
        expect(order.indexToken).to.be.equal(btc.address);
        expect(order.sizeDelta).to.be.equal(defaults.sizeDelta);
        expect(order.purchaseTokenAmount).to.be.equal(defaults.amountIn);
        expect(order.isLong).to.be.false;
        expect(order.triggerPrice).to.be.equal(defaults.triggerPrice);
        expect(order.triggerAbovePrice).to.be.true;
        expect(order.isIncrease).to.be.true;
        expect(order.executionFee).to.be.equal(defaults.executionFee);
    });

    it("createIncreasePositionOrder, short A, transfer A, purchase B", async () => {
        const daiBalanceBefore = await dai.balanceOf(orderBook.address);
        await defaultCreateIncreasePositionOrder({
            path: [btc.address, dai.address],
            isLong: false,
            triggerAbovePrice: true
        });
        const daiBalanceAfter = await dai.balanceOf(orderBook.address);

        const order = await getCreatedOrder(defaults.user.address);

        expect(await bnb.balanceOf(orderBook.address)).to.be.equal(defaults.executionFee);
        // Q: is it ok to compare with gt and compare to *0.98? To consider fees
        expect(daiBalanceAfter.sub(daiBalanceBefore).gt(defaults.amountIn.mul(BTC_PRICE).mul(98).div(100))).to.be.true;

        expect(order.account).to.be.equal(defaults.user.address);
        expect(order.purchaseToken).to.be.equal(dai.address);
        expect(order.indexToken).to.be.equal(btc.address);
        expect(order.sizeDelta).to.be.equal(defaults.sizeDelta);
        expect(order.purchaseTokenAmount).to.be.above(expandDecimals(BTC_PRICE * 0.99, 18));
        expect(order.isLong).to.be.false;
        expect(order.triggerPrice).to.be.equal(defaults.triggerPrice);
        expect(order.triggerAbovePrice).to.be.true;
        expect(order.isIncrease).to.be.true;
        expect(order.executionFee).to.be.equal(defaults.executionFee);
    });
});








