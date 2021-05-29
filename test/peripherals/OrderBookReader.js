const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

const PRICE_PRECISION = ethers.BigNumber.from(10).pow(30);

describe("OrderBookReader", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let orderBook;
  let reader;
  let dai;
  let bnb;
  let vault;
  let usdg;
  let router;

  beforeEach(async () => {
    dai = await deployContract("Token", [])
    btc = await deployContract("Token", [])

    bnb = await deployContract("Token", [])
    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address])

    orderBook = await deployContract("OrderBook", [])
    await router.addPlugin(orderBook.address);
    await router.connect(user0).approvePlugin(orderBook.address);
    await orderBook.initialize(
      router.address,
      vault.address,
      bnb.address,
      usdg.address,
      400000, 
      expandDecimals(5, 30) // minPurchseTokenAmountUsd
    );
    reader = await deployContract("OrderBookReader", [])

    await dai.mint(user0.address, expandDecimals(10000000, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(1000000, 18))
  })

  function createSwapOrder(toToken = bnb.address) {
    const executionFee = 500000;

    return orderBook.connect(user0).createSwapOrder(
      [dai.address, toToken],
      expandDecimals(1000, 18),
      expandDecimals(990, 18),
      expandDecimals(1, 30),
      true,
      executionFee,
      false,
      {value: executionFee}
    );
  }

  function unflattenSwapOrders(swapOrders) {
    const propsLength = 8;
    const count = swapOrders.length / propsLength;
    const ret = [];
    for (let i = 0; i < count; i++) {
      ret.push(swapOrders.slice(propsLength * i, propsLength * (i+ 1)));
    }
    return ret;
  }

	it("getSwapOrders", async () => {
    await createSwapOrder(bnb.address);
    await createSwapOrder(btc.address);

    const [order1, order2] = unflattenSwapOrders(await reader.getSwapOrders(orderBook.address, user0.address, 0, 2));

    expect(order1[0].toHexString().toLowerCase()).to.be.equal(dai.address.toLowerCase());
    expect(order1[1].toHexString().toLowerCase()).to.be.equal(btc.address.toLowerCase());
    expect(order1[7].toString()).to.be.equal('1');

    expect(order2[0].toHexString().toLowerCase()).to.be.equal(dai.address.toLowerCase());
    expect(order2[1].toHexString().toLowerCase()).to.be.equal(bnb.address.toLowerCase());
    expect(order2[7].toString()).to.be.equal('0');
	})
});