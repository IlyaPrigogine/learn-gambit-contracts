const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")

use(solidity)

describe("Vault.sellUSDG", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let router
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let dai
  let daiPriceFeed
  let distributor0
  let yieldTracker0

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address])

    await initVault(vault, router, usdg)

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    await vault.enableMinting()
  })

  // it("sellUSDG", async () => {
  //   await expect(vault.connect(user0).sellUSDG(bnb.address, user1.address))
  //     .to.be.revertedWith("Vault: _token not whitelisted")
  //
  //   await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
  //   await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
  //
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
  //   await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))
  //
  //   await bnb.mint(user0.address, 100)
  //
  //   expect(await usdg.balanceOf(user0.address)).eq(0)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(bnb.address)).eq(0)
  //   expect(await vault.usdgAmounts(bnb.address)).eq(0)
  //   expect(await vault.poolAmounts(bnb.address)).eq(0)
  //   expect(await bnb.balanceOf(user0.address)).eq(100)
  //   await bnb.connect(user0).transfer(vault.address, 100)
  //   await vault.connect(user0).buyUSDG(bnb.address, user0.address)
  //   expect(await usdg.balanceOf(user0.address)).eq(29700)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(bnb.address)).eq(1)
  //   expect(await vault.usdgAmounts(bnb.address)).eq(29700)
  //   expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
  //   expect(await bnb.balanceOf(user0.address)).eq(0)
  //
  //   await expect(vault.connect(user0).sellUSDG(bnb.address, user1.address))
  //     .to.be.revertedWith("Vault: invalid usdgAmount")
  //
  //   await usdg.connect(user0).transfer(vault.address, 15000)
  //
  //   await expect(vault.connect(user0).sellUSDG(btc.address, user1.address))
  //     .to.be.revertedWith("Vault: invalid redemptionAmount")
  //
  //   const tx = await vault.connect(user0).sellUSDG(bnb.address, user1.address)
  //   await reportGasUsed(provider, tx, "sellUSDG gas used")
  //   expect(await usdg.balanceOf(user0.address)).eq(29700 - 15000)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(bnb.address)).eq(2)
  //   expect(await vault.usdgAmounts(bnb.address)).eq(29700 - 15000)
  //   expect(await vault.poolAmounts(bnb.address)).eq(100 - 1 - 45)
  //   expect(await bnb.balanceOf(user0.address)).eq(0)
  //   expect(await bnb.balanceOf(user1.address)).eq(45 - 1) // (15000 / 29700) * 99 => 50, 50 * 0.9 => 45
  // })
  //
  // it("sellUSDG after a price increase", async () => {
  //   await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
  //   await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
  //
  //   await bnb.mint(user0.address, 100)
  //
  //   expect(await usdg.balanceOf(user0.address)).eq(0)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(bnb.address)).eq(0)
  //   expect(await vault.usdgAmounts(bnb.address)).eq(0)
  //   expect(await vault.poolAmounts(bnb.address)).eq(0)
  //   expect(await bnb.balanceOf(user0.address)).eq(100)
  //   await bnb.connect(user0).transfer(vault.address, 100)
  //   await vault.connect(user0).buyUSDG(bnb.address, user0.address)
  //
  //   expect(await usdg.balanceOf(user0.address)).eq(29700)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //
  //   expect(await vault.feeReserves(bnb.address)).eq(1)
  //   expect(await vault.usdgAmounts(bnb.address)).eq(29700)
  //   expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
  //   expect(await bnb.balanceOf(user0.address)).eq(0)
  //
  //   await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
  //   await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
  //   await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))
  //
  //   await usdg.connect(user0).transfer(vault.address, 15000)
  //   await vault.connect(user0).sellUSDG(bnb.address, user1.address)
  //
  //   expect(await usdg.balanceOf(user0.address)).eq(29700 - 15000)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(bnb.address)).eq(2)
  //   expect(await vault.usdgAmounts(bnb.address)).eq(29700 - 15000)
  //   expect(await vault.poolAmounts(bnb.address)).eq(100 - 1 - 25)
  //   expect(await bnb.balanceOf(user0.address)).eq(0)
  //   expect(await bnb.balanceOf(user1.address)).eq(25 - 1) // (15000 / 600) => 25
  // })

  // it("sellUSDG redeem based on price", async () => {
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
  //   await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))
  //
  //   await btc.mint(user0.address, expandDecimals(2, 8))
  //
  //   expect(await usdg.balanceOf(user0.address)).eq(0)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(btc.address)).eq(0)
  //   expect(await vault.usdgAmounts(btc.address)).eq(0)
  //   expect(await vault.poolAmounts(btc.address)).eq(0)
  //   expect(await btc.balanceOf(user0.address)).eq(expandDecimals(2, 8))
  //
  //   await btc.connect(user0).transfer(vault.address, expandDecimals(2, 8))
  //   await vault.connect(user0).buyUSDG(btc.address, user0.address)
  //
  //   expect(await usdg.balanceOf(user0.address)).eq("119640000000000000000000") // 119,640
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(btc.address)).eq("600000") // 0.006 BTC, 2 * 0.03%
  //   expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000") // 119,640
  //   expect(await vault.poolAmounts(btc.address)).eq("199400000") // 1.994 BTC
  //   expect(await btc.balanceOf(user0.address)).eq(0)
  //   expect(await btc.balanceOf(user1.address)).eq(0)
  //
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(82000))
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(80000))
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(83000))
  //
  //   await usdg.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
  //   await vault.connect(user0).sellUSDG(btc.address, user1.address)
  //
  //   expect(await btc.balanceOf(user1.address)).eq("12012047") // 0.12012047 BTC, 0.12012047 * 83000 => 9969.999
  // })
  //
  // it("sellUSDG redeem based on collateral", async () => {
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
  //   await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))
  //
  //   await btc.mint(user0.address, expandDecimals(2, 8))
  //
  //   expect(await usdg.balanceOf(user0.address)).eq(0)
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(btc.address)).eq(0)
  //   expect(await vault.usdgAmounts(btc.address)).eq(0)
  //   expect(await vault.poolAmounts(btc.address)).eq(0)
  //   expect(await btc.balanceOf(user0.address)).eq(expandDecimals(2, 8))
  //
  //   await btc.connect(user0).transfer(vault.address, expandDecimals(2, 8))
  //   await vault.connect(user0).buyUSDG(btc.address, user0.address)
  //
  //   expect(await usdg.balanceOf(user0.address)).eq("119640000000000000000000") // 119,640
  //   expect(await usdg.balanceOf(user1.address)).eq(0)
  //   expect(await vault.feeReserves(btc.address)).eq("600000") // 0.006 BTC, 2 * 0.03%
  //   expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000") // 119,640
  //   expect(await vault.poolAmounts(btc.address)).eq("199400000") // 1.994 BTC
  //   expect(await btc.balanceOf(user0.address)).eq(0)
  //   expect(await btc.balanceOf(user1.address)).eq(0)
  //
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(52000))
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000))
  //   await btcPriceFeed.setLatestAnswer(toChainlinkPrice(53000))
  //
  //   await usdg.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
  //   await vault.connect(user0).sellUSDG(btc.address, user1.address)
  //
  //   // 1.994 * 0.9 / 119,640 * 10,000 * 99.7% => 0.14955
  //   expect(await btc.balanceOf(user1.address)).eq("14954999") // 0.14954999 BTC, 0.14954999 * 53000, 7926.14947 USD
  // })

  it("sellUSDG for stableTokens", async () => {
    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await dai.mint(user0.address, expandDecimals(10000, 18))

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(dai.address)).eq(0)
    expect(await vault.usdgAmounts(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq(0)
    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(10000, 18))

    await dai.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
    await vault.connect(user0).buyUSDG(dai.address, user0.address)

    expect(await usdg.balanceOf(user0.address)).eq(expandDecimals(9996, 18))
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(dai.address)).eq(expandDecimals(4, 18))
    expect(await vault.usdgAmounts(dai.address)).eq(expandDecimals(9996, 18))
    expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(9996, 18))
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await dai.balanceOf(user1.address)).eq(0)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(5000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await btc.mint(user0.address, expandDecimals(1, 8))

    expect(await dai.balanceOf(user2.address)).eq(0)

    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
    await vault.connect(user0).swap(btc.address, dai.address, user2.address)

    expect(await vault.feeReserves(dai.address)).eq(expandDecimals(19, 18))
    expect(await vault.usdgAmounts(dai.address)).eq(expandDecimals(4996, 18))
    expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(4996, 18))

    expect(await dai.balanceOf(user2.address)).eq(expandDecimals(4985, 18))

    await usdg.connect(user0).approve(router.address, expandDecimals(5000, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address], expandDecimals(5000, 18), 0, user3.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")

    expect(await dai.balanceOf(user3.address)).eq(0)
    await router.connect(user0).swap([usdg.address, dai.address], expandDecimals(4000, 18), 0, user3.address)
    expect(await dai.balanceOf(user3.address)).eq("3998400000000000000000") // 3998.4

    expect(await vault.feeReserves(dai.address)).eq("20600000000000000000") // 20.6
    expect(await vault.usdgAmounts(dai.address)).eq(expandDecimals(996, 18))
    expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(996, 18))
  })
})
