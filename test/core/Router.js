const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

describe("Router", function () {
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
  let reader

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

    await vault.initialize(router.address, usdg.address, expandDecimals(200 * 1000, 18), toUsd(5), 600)

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    reader = await deployContract("Reader", [])

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(
      dai.address, // _token
      daiPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      true // _isStable
    )

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      8, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      false // _isStable
    )

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      false // _isStable
    )
  })

  it("swap, buy USDG", async () => {
    await dai.mint(user0.address, expandDecimals(200, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(200, 18))

    await expect(router.connect(user0).swap([dai.address, usdg.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(200, 18))
    expect(await usdg.balanceOf(user0.address)).eq(0)
    const tx = await router.connect(user0).swap([dai.address, usdg.address], expandDecimals(200, 18), expandDecimals(199, 18), user0.address)
    await reportGasUsed(provider, tx, "buyUSDG gas used")
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user0.address)).eq("199400000000000000000") // 199.4
  })

  it("swap, sell USDG", async () => {
    await dai.mint(user0.address, expandDecimals(200, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(200, 18))

    await expect(router.connect(user0).swap([dai.address, usdg.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(200, 18))
    expect(await usdg.balanceOf(user0.address)).eq(0)
    const tx = await router.connect(user0).swap([dai.address, usdg.address], expandDecimals(200, 18), expandDecimals(199, 18), user0.address)
    await reportGasUsed(provider, tx, "sellUSDG gas used")
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user0.address)).eq("199400000000000000000") // 199.4

    await usdg.connect(user0).approve(router.address, expandDecimals(100, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address], expandDecimals(100, 18), expandDecimals(100, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    await router.connect(user0).swap([usdg.address, dai.address], expandDecimals(100, 18), expandDecimals(99, 18), user0.address)
    expect(await dai.balanceOf(user0.address)).eq("99700000000000000000") // 99.7
    expect(await usdg.balanceOf(user0.address)).eq("99400000000000000000") // 99.4
  })

  it("swap, path.length == 2", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).approve(router.address, expandDecimals(1, 8))
    await expect(router.connect(user0).swap([btc.address, usdg.address], expandDecimals(1, 8), expandDecimals(60000, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")
    await router.connect(user0).swap([btc.address, usdg.address], expandDecimals(1, 8), expandDecimals(59000, 18), user0.address)

    await dai.mint(user0.address, expandDecimals(30000, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(30000, 18))
    await expect(router.connect(user0).swap([dai.address, btc.address], expandDecimals(30000, 18), "50000000", user0.address)) // 0.5 BTC
      .to.be.revertedWith("Router: insufficient amountOut")

    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(30000, 18))
    expect(await btc.balanceOf(user0.address)).eq(0)
    const tx = await router.connect(user0).swap([dai.address, btc.address], expandDecimals(30000, 18), "49000000", user0.address)
    await reportGasUsed(provider, tx, "swap gas used")
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await btc.balanceOf(user0.address)).eq("49850000") // 0.4985
  })

  it("swap, path.length == 3", async () => {
    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).approve(router.address, expandDecimals(1, 8))
    await router.connect(user0).swap([btc.address, usdg.address], expandDecimals(1, 8), expandDecimals(59000, 18), user0.address)

    await dai.mint(user0.address, expandDecimals(30000, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(30000, 18))
    await router.connect(user0).swap([dai.address, usdg.address], expandDecimals(30000, 18), expandDecimals(29000, 18), user0.address)

    await usdg.connect(user0).approve(router.address, expandDecimals(20000, 18))

    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user0.address)).eq(expandDecimals(89730, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address, usdg.address], expandDecimals(20000, 18), expandDecimals(20000, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    await router.connect(user0).swap([usdg.address, dai.address, usdg.address], expandDecimals(20000, 18), expandDecimals(19000, 18), user0.address)
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user0.address)).eq("89610180000000000000000") // 89610.18

    await usdg.connect(user0).approve(router.address, expandDecimals(40000, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address, btc.address], expandDecimals(30000, 18), expandDecimals(39000, 18), user0.address))
      .to.be.revertedWith("Vault: poolAmount exceeded") // this reverts as some DAI has been transferred from the pool to the fee reserve

    expect(await vault.poolAmounts(dai.address)).eq("29790180000000000000000") // 29790.18
    expect(await vault.feeReserves(dai.address)).eq("209820000000000000000") // 209.82

    await expect(router.connect(user0).swap([usdg.address, dai.address, btc.address], expandDecimals(20000, 18), "34000000", user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    const tx = await router.connect(user0).swap([usdg.address, dai.address, btc.address], expandDecimals(20000, 18), "33000000", user0.address)
    await reportGasUsed(provider, tx, "swap gas used")
    expect(await usdg.balanceOf(user0.address)).eq("69610180000000000000000") // 69610.18
    expect(await btc.balanceOf(user0.address)).eq("33133633") // 0.33133633 BTC
  })
})
