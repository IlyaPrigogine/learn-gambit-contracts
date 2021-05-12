const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, reportGasUsed, gasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../Vault/helpers")
const { getDefault, validateOrderFields, getTxFees, positionWrapper } = require('./helpers');

use(solidity);

const BTC_PRICE = 60000;
const BNB_PRICE = 300;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PRICE_PRECISION = ethers.BigNumber.from(10).pow(30);
const BASIS_POINTS_DIVISOR = 10000;

describe("OrderBook, increase position orders", function () {
    const provider = waffle.provider
    const [wallet, user0, user1, user2, user3] = provider.getWallets()

    let orderBook;
    let defaults;
    let tokenDecimals;

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
        await vaultPriceFeed.setPriceSampleSpace(1);

        tokenDecimals = {
            [bnb.address]: 18,
            [dai.address]: 18,
            [btc.address]: 8
        };

        await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
        await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

        await btcPriceFeed.setLatestAnswer(toChainlinkPrice(BTC_PRICE))
        await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

        await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(BNB_PRICE))
        await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

        await vault.setIsMintingEnabled(true)

        orderBook = await deployContract("OrderBook", [])
        const minExecutionFee = 500000;
        await orderBook.initialize(
            router.address,
            vault.address,
            bnb.address,
            usdg.address,
            minExecutionFee, 
            expandDecimals(5, 30) // minPurchseTokenAmountUsd
        );

        await router.addPlugin(orderBook.address);
        await router.connect(user0).approvePlugin(orderBook.address);

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).approve(router.address, expandDecimals(100, 8))

        await dai.mint(user0.address, expandDecimals(10000000, 18))
        await dai.connect(user0).approve(router.address, expandDecimals(1000000, 18))

        await dai.mint(user0.address, expandDecimals(20000000, 18))
        await dai.connect(user0).transfer(vault.address, expandDecimals(2000000, 18))
        await vault.directPoolDeposit(dai.address);

        await btc.mint(user0.address, expandDecimals(1000, 8))
        await btc.connect(user0).transfer(vault.address, expandDecimals(100, 8))
        await vault.directPoolDeposit(btc.address);

        await bnb.mint(user0.address, expandDecimals(50000, 18))
        await bnb.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
        await vault.directPoolDeposit(bnb.address);

        defaults = {
            path: [btc.address],
            sizeDelta: toUsd(100000),
            amountIn: expandDecimals(1, 8),
            minOut: 0,
            triggerPrice: toUsd(53000),
            triggerAboveThreshold: true,
            executionFee: expandDecimals(1, 9).mul(1500000),
            collateralToken: btc.address,
            collateralDelta: toUsd(BTC_PRICE),
            user: user0,
            isLong: true
        };
    });

    async function getCreatedIncreaseOrder(address, orderIndex = 0) {
        const order = await orderBook.increaseOrders(address, orderIndex);
        return order;
    }

    function defaultCreateIncreaseOrder(props = {}) {
        return orderBook.connect(getDefault(props, 'user', defaults.user)).createIncreaseOrder(
            getDefault(props, 'path', defaults.path),
            getDefault(props, 'amountIn', defaults.amountIn),
            getDefault(props, 'indexToken', defaults.path[defaults.path.length - 1]),
            getDefault(props, 'minOut', defaults.minOut),
            getDefault(props, 'sizeDelta', defaults.sizeDelta),
            getDefault(props, 'collateralToken', defaults.collateralToken), // _collateralToken
            getDefault(props, 'isLong', defaults.isLong),
            getDefault(props, 'triggerPrice', defaults.triggerPrice),
            getDefault(props, 'triggerAboveThreshold', defaults.triggerAboveThreshold),
            getDefault(props, 'executionFee', defaults.executionFee),
            {value: getDefault(props, 'value', props.executionFee || defaults.executionFee)}
        );
    }

    it("createIncreaseOrder, bad input", async () => {
        const badExecutionFee = 100;
        await expect(defaultCreateIncreaseOrder({
            executionFee: badExecutionFee
        })).to.be.revertedWith("OrderBook: insufficient execution fee");

        const goodExecutionFee = expandDecimals(1, 8);
        await expect(defaultCreateIncreaseOrder({
            executionFee: goodExecutionFee,
            value: goodExecutionFee - 1
        })).to.be.revertedWith("OrderBook: incorrect execution fee transferred");

        await expect(defaultCreateIncreaseOrder({
            path: [bnb.address],
            executionFee: goodExecutionFee,
            value: expandDecimals(10, 8).add(goodExecutionFee).sub(1)
        })).to.be.revertedWith("OrderBook: incorrect value transferred");

        await expect(defaultCreateIncreaseOrder({
            path: [dai.address],
            amountIn: expandDecimals(4, 18)
        })).to.be.revertedWith("OrderBook: insufficient collateral");
    });

    it("createIncreaseOrder, two orders", async () => {
        const sizeDelta1 = toUsd(40000);
        await defaultCreateIncreaseOrder({
            path: [btc.address],
            amountIn: expandDecimals(1, 8).div(10),
            sizeDelta: sizeDelta1
        });
        const sizeDelta2 = toUsd(50000);
        await defaultCreateIncreaseOrder({
            path: [btc.address],
            amountIn: expandDecimals(1, 8).div(10),
            sizeDelta: sizeDelta2
        });

        const order1 = await getCreatedIncreaseOrder(defaults.user.address, 0);
        const order2 = await getCreatedIncreaseOrder(defaults.user.address, 1);

        expect(order1.sizeDelta).to.be.equal(sizeDelta1);
        expect(order2.sizeDelta).to.be.equal(sizeDelta2);
    });

    it("createIncreaseOrder, pay BNB", async () => {
        const bnbBalanceBefore = await bnb.balanceOf(orderBook.address);
        const amountIn = expandDecimals(30, 18);
        const value = defaults.executionFee.add(amountIn);
        const tx = await defaultCreateIncreaseOrder({
            path: [bnb.address],
            amountIn,
            value
        });

        reportGasUsed(provider, tx, 'createIncreaseOrder gas used');

        const order = await getCreatedIncreaseOrder(user0.address);
        const bnbBalanceAfter = await bnb.balanceOf(orderBook.address);

        const bnbBalanceDiff = bnbBalanceAfter.sub(bnbBalanceBefore);
        expect(bnbBalanceDiff, 'BNB balance').to.be.equal(value);

        validateOrderFields(order, {
            account: defaults.user.address,
            purchaseToken: bnb.address,
            purchaseTokenAmount: amountIn,
            indexToken: btc.address,
            sizeDelta: defaults.sizeDelta,
            isLong: true,
            triggerPrice: defaults.triggerPrice,
            triggerAboveThreshold: true,
            executionFee: defaults.executionFee
        });
    });

    it("createIncreaseOrder, long A, transfer and purchase A", async () => {
        const btcBalanceBefore = await btc.balanceOf(orderBook.address);
        const tx = await defaultCreateIncreaseOrder();
        reportGasUsed(provider, tx, 'createIncreaseOrder gas used');

        const order = await getCreatedIncreaseOrder(user0.address);
        const btcBalanceAfter = await btc.balanceOf(orderBook.address);

        expect(await bnb.balanceOf(orderBook.address), 'BNB balance').to.be.equal(defaults.executionFee);
        expect(btcBalanceAfter.sub(btcBalanceBefore), 'BTC balance').to.be.equal(defaults.amountIn);

        validateOrderFields(order, {
            account: defaults.user.address,
            purchaseToken: btc.address,
            purchaseTokenAmount: defaults.amountIn,
            indexToken: btc.address,
            sizeDelta: defaults.sizeDelta,
            isLong: true,
            triggerPrice: defaults.triggerPrice,
            triggerAboveThreshold: true,
            executionFee: defaults.executionFee
        });
    });

    it("createIncreaseOrder, long A, transfer A, purchase B", async () => {
        const daiBalanceBefore = await dai.balanceOf(orderBook.address);
        const tx = await defaultCreateIncreaseOrder({
            path: [btc.address, dai.address]
        });
        reportGasUsed(provider, tx, 'createIncreaseOrder gas used');
        const daiBalanceAfter = await dai.balanceOf(orderBook.address);
        const order = await getCreatedIncreaseOrder(defaults.user.address);

        expect(await bnb.balanceOf(orderBook.address), 'BNB balance').to.be.equal(defaults.executionFee);
        // Q: is it ok to compare with gt and compare to *0.98? To consider fees
        expect(daiBalanceAfter.sub(daiBalanceBefore).gt(defaults.amountIn.mul(BTC_PRICE).mul(98).div(100)), 'daiBalanceAfter').to.be.true;

        validateOrderFields(order, {
            account: defaults.user.address,
            purchaseToken: dai.address,
            indexToken: btc.address,
            sizeDelta: defaults.sizeDelta,
            isLong: true,
            triggerPrice: defaults.triggerPrice,
            triggerAboveThreshold: true,
            executionFee: defaults.executionFee
        });
        expect(order.purchaseTokenAmount, 'purchaseTokenAmount').to.be.above(expandDecimals(BTC_PRICE * 0.99, 18));
    });

    it("createIncreaseOrder, short A, transfer B, purchase B", async () => {
        const daiBalanceBefore = await dai.balanceOf(orderBook.address);
        const amountIn = expandDecimals(30000, 18);
        const tx = await defaultCreateIncreaseOrder({
            path: [dai.address],
            amountIn,
            isLong: false,
            triggerAboveThreshold: true
        });
        reportGasUsed(provider, tx, 'createIncreaseOrder gas used');
        const daiBalanceAfter = await dai.balanceOf(orderBook.address);

        const order = await getCreatedIncreaseOrder(defaults.user.address);
        expect(await bnb.balanceOf(orderBook.address)).to.be.equal(defaults.executionFee);
        expect(daiBalanceAfter.sub(daiBalanceBefore), 'daiBalanceAfter').to.be.equal(amountIn);

        validateOrderFields(order, {
            account: defaults.user.address,
            purchaseToken: dai.address,
            indexToken: btc.address,
            sizeDelta: defaults.sizeDelta,
            isLong: false,
            triggerPrice: defaults.triggerPrice,
            triggerAboveThreshold: true,
            executionFee: defaults.executionFee
        });
    });

    it("createIncreaseOrder, short A, transfer A, purchase B", async () => {
        const daiBalanceBefore = await dai.balanceOf(orderBook.address);
        const tx = await defaultCreateIncreaseOrder({
            path: [btc.address, dai.address],
            isLong: false,
            triggerAboveThreshold: true
        });
        reportGasUsed(provider, tx, 'createIncreaseOrder gas used');
        const daiBalanceAfter = await dai.balanceOf(orderBook.address);

        const order = await getCreatedIncreaseOrder(defaults.user.address);

        expect(await bnb.balanceOf(orderBook.address)).to.be.equal(defaults.executionFee);
        expect(daiBalanceAfter).to.be.equal(daiBalanceBefore.add("59820000000000000000000"));

        validateOrderFields(order, {
            account: defaults.user.address,
            purchaseToken: dai.address,
            indexToken: btc.address,
            sizeDelta: defaults.sizeDelta,
            isLong: false,
            triggerPrice: defaults.triggerPrice,
            triggerAboveThreshold: true,
            executionFee: defaults.executionFee
        });
        expect(order.purchaseTokenAmount).to.be.above(expandDecimals(BTC_PRICE * 0.99, 18));
    });

    it("updateIncreaseOrder", async () => {
        await defaultCreateIncreaseOrder();

        const newSizeDelta = defaults.sizeDelta.add(100);
        const newTriggerPrice = defaults.triggerPrice.add(100);
        const newTriggerAboveThreshold = !defaults.triggerAboveThreshold;

        await expect(orderBook.connect(user1).updateIncreaseOrder(0, newSizeDelta, newTriggerPrice, newTriggerAboveThreshold))
            .to.be.revertedWith("OrderBook: non-existent order");

        const tx = await orderBook.connect(user0).updateIncreaseOrder(0, newSizeDelta, newTriggerPrice, newTriggerAboveThreshold);
        reportGasUsed(provider, tx, 'updateIncreaseOrder gas used');

        order = await getCreatedIncreaseOrder(user0.address);

        validateOrderFields(order, {
            sizeDelta: newSizeDelta,
            triggerPrice: newTriggerPrice,
            triggerAboveThreshold: newTriggerAboveThreshold
        });
    });

    it("cancelOrder", async () => {
        const bnbBalanceBefore = await defaults.user.getBalance();
        const tokenBalanceBefore = await btc.balanceOf(defaults.user.address);
        const tx1 = await defaultCreateIncreaseOrder();
        let txFees = await getTxFees(provider, tx1);

        await expect(orderBook.connect(user1).cancelIncreaseOrder(0)).to.be.revertedWith("OrderBook: non-existent order");

        const tx2 = await orderBook.connect(user0).cancelIncreaseOrder(0);
        reportGasUsed(provider, tx2, 'cancelIncreaseOrder gas used');

        txFees = txFees.add(await getTxFees(provider, tx2));
        const bnbBalanceAfter = await defaults.user.getBalance();
        expect(bnbBalanceAfter, 'Before and after token balance are not equal')
            .to.be.equal(bnbBalanceBefore.sub(txFees));

        const tokenBalanceAfter = await btc.balanceOf(defaults.user.address);
        expect(tokenBalanceAfter, 'tokenBalanceAfter').to.be.equal(tokenBalanceBefore);

        const order = await getCreatedIncreaseOrder(defaults.user.address);
        expect(order.account).to.be.equal(ZERO_ADDRESS);
    });

    it("cancelOrder, pay BNB", async () => {
        const balanceBefore = await defaults.user.getBalance();
        const bnbBalanceBefore = await bnb.balanceOf(orderBook.address);
        const amountIn = expandDecimals(30, 18);
        const value = defaults.executionFee.add(amountIn);
        const tx1 = await defaultCreateIncreaseOrder({
            path: [bnb.address],
            amountIn,
            value
        });
        let txFees = await getTxFees(provider, tx1);

        await expect(orderBook.connect(user1).cancelIncreaseOrder(0)).to.be.revertedWith("OrderBook: non-existent order");

        const tx2 = await orderBook.connect(user0).cancelIncreaseOrder(0);
        reportGasUsed(provider, tx2, 'cancelIncreaseOrder gas used');
        txFees = txFees.add(await getTxFees(provider, tx2));

        const balanceAfter = await defaults.user.getBalance();
        expect(balanceAfter, "Before and after balance are not equal").to.be.equal(balanceBefore.sub(txFees));

        const order = await getCreatedIncreaseOrder(defaults.user.address);
        expect(order.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, non-existent order", async () => {
        await expect(orderBook.executeIncreaseOrder(user3.address, 0, user1.address)).to.be.revertedWith("OrderBook: non-existent order");
    });

    it("executeOrder, current price is invalid", async () => {
        let orderIndex = 0;

        await defaultCreateIncreaseOrder({triggerPrice: expandDecimals(BTC_PRICE + 1000, 30)});
        const orderA = await orderBook.increaseOrders(defaults.user.address, orderIndex++);

        await expect(orderBook.executeIncreaseOrder(orderA.account, orderA.index, user1.address))
            .to.be.revertedWith("OrderBook: invalid price for execution");

        await defaultCreateIncreaseOrder({
            triggerPrice: expandDecimals(BTC_PRICE + 1000, 30),
            isLong: false,
            triggerAboveThreshold: true
        });
        const orderB = await orderBook.increaseOrders(defaults.user.address, orderIndex++);
        await expect(orderBook.executeIncreaseOrder(orderB.account, orderB.index, user1.address))
            .to.be.revertedWith("OrderBook: invalid price for execution");
    });

    it("executeOrder, long, purchase token same as collateral", async () => {
        await defaultCreateIncreaseOrder();

        const order = await orderBook.increaseOrders(defaults.user.address, 0);

        const executorBalanceBefore = await user1.getBalance();
        const tx = await orderBook.executeIncreaseOrder(defaults.user.address, 0, user1.address);
        reportGasUsed(provider, tx, 'executeIncreaseOrder gas used');

        const executorBalanceAfter = await user1.getBalance();
        expect(executorBalanceAfter.gt(executorBalanceBefore)).to.be.true

        const position = positionWrapper(await vault.getPosition(defaults.user.address, btc.address, btc.address, defaults.isLong));
        expect(position.size).to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.increaseOrders(defaults.user.address, 0);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, long, swap purchase token to collateral", async () => {
        await defaultCreateIncreaseOrder({
            path: [dai.address],
            amountIn: expandDecimals(50000, 18)
        });

        const order = await orderBook.increaseOrders(defaults.user.address, 0);
        const tx = await orderBook.executeIncreaseOrder(defaults.user.address, 0, user1.address);
        reportGasUsed(provider, tx, 'executeIncreaseOrder gas used');

        const position = positionWrapper(await vault.getPosition(user0.address, btc.address, btc.address, defaults.isLong));
        expect(position.size).to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.increaseOrders(defaults.user.address, 0);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, short, purchase token same as collateral", async () => {
        dai.mint(user0.address, expandDecimals(50000, 18));
        await defaultCreateIncreaseOrder({
            path: [dai.address],
            collateralToken: dai.address,
            isLong: false,
            amountIn: expandDecimals(50000, 18),
            triggerAboveThreshold: true,
            triggerPrice: expandDecimals(BTC_PRICE - 100, 30)
        });

        const order = await orderBook.increaseOrders(defaults.user.address, 0);
        const tx = await orderBook.executeIncreaseOrder(defaults.user.address, 0, user1.address);
        reportGasUsed(provider, tx, 'executeIncreaseOrder gas used');

        const position = positionWrapper(await vault.getPosition(defaults.address, dai.address, btc.address, false));
        expect(position.size, 'position.size').to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.increaseOrders(defaults.user.address, 0);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, short, swap purchase token to collateral", async () => {
        await defaultCreateIncreaseOrder({
            isLong: false,
            collateralToken: dai.address,
            triggerAboveThreshold: true,
            triggerPrice: expandDecimals(BTC_PRICE - 100, 30)
        });

        const order = await orderBook.increaseOrders(defaults.user.address, 0);
        const tx = await orderBook.executeIncreaseOrder(defaults.user.address, 0, user1.address);
        reportGasUsed(provider, tx, 'executeIncreaseOrder gas used');

        const position = positionWrapper(await vault.getPosition(user0.address, dai.address, btc.address, false));
        expect(position.size, 'position.size').to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.increaseOrders(defaults.user.address, 0);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("executeOrder, short, pay BNB, no swap", async () => {
        const amountIn = expandDecimals(50, 18);
        const value = defaults.executionFee.add(amountIn)
        await defaultCreateIncreaseOrder({
            path: [bnb.address],
            amountIn,
            value,
            indexToken: bnb.address,
            collateralToken: dai.address,
            isLong: false,
            triggerboveThreshold: true,
            triggerPrice: expandDecimals(BNB_PRICE - 10, 30)
        });

        const order = await orderBook.increaseOrders(defaults.user.address, 0);
        const tx = await orderBook.executeIncreaseOrder(defaults.user.address, 0, user1.address);
        reportGasUsed(provider, tx, 'executeIncreaseOrder gas used');

        const position = positionWrapper(await vault.getPosition(user0.address, dai.address, bnb.address, false));
        expect(position.size, 'position.size').to.be.equal(order.sizeDelta);

        const orderAfter = await orderBook.increaseOrders(defaults.user.address, 0);
        expect(orderAfter.account).to.be.equal(ZERO_ADDRESS);
    });

    it("createIncreaseOrder, bad path", async () => {
        await expect(defaultCreateIncreaseOrder({
            path: [btc.address, btc.address]
        })).to.be.revertedWith("OrderBook: invalid _path");
    });
});
