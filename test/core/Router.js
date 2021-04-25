const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./Vault/helpers")

use(solidity)

describe("Router", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let router
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed
  let busd
  let busdPriceFeed
  let distributor0
  let yieldTracker0
  let reader

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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await vault.enableMinting()
  })

  it("swap, buy USDG", async () => {
    await vaultPriceFeed.getPrice(dai.address, true, true)
    await dai.mint(user0.address, expandDecimals(200, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(200, 18))

    await expect(router.connect(user0).swap([dai.address, usdg.address], expandDecimals(200, 18), expandDecimals(201, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    expect(await dai.balanceOf(user0.address)).eq(expandDecimals(200, 18))
    expect(await usdg.balanceOf(user0.address)).eq(0)
    const tx = await router.connect(user0).swap([dai.address, usdg.address], expandDecimals(200, 18), expandDecimals(199, 18), user0.address)
    await reportGasUsed(provider, tx, "buyUSDG gas used")
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user0.address)).eq("199920000000000000000") // 199.92
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
    expect(await usdg.balanceOf(user0.address)).eq("199920000000000000000") // 199.92

    await usdg.connect(user0).approve(router.address, expandDecimals(100, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address], expandDecimals(100, 18), expandDecimals(100, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    await router.connect(user0).swap([usdg.address, dai.address], expandDecimals(100, 18), expandDecimals(99, 18), user0.address)
    expect(await dai.balanceOf(user0.address)).eq("99960000000000000000") // 99.96
    expect(await usdg.balanceOf(user0.address)).eq("99920000000000000000") // 99.92
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
    expect(await usdg.balanceOf(user0.address)).eq(expandDecimals(89808, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address, usdg.address], expandDecimals(20000, 18), expandDecimals(20000, 18), user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    await router.connect(user0).swap([usdg.address, dai.address, usdg.address], expandDecimals(20000, 18), expandDecimals(19000, 18), user0.address)
    expect(await dai.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user0.address)).eq("89792003200000000000000") // 89792.0032

    await usdg.connect(user0).approve(router.address, expandDecimals(40000, 18))
    await expect(router.connect(user0).swap([usdg.address, dai.address, btc.address], expandDecimals(30000, 18), expandDecimals(39000, 18), user0.address))
      .to.be.revertedWith("Vault: poolAmount exceeded") // this reverts as some DAI has been transferred from the pool to the fee reserve

    expect(await vault.poolAmounts(dai.address)).eq("29972003200000000000000") // 29972.0032
    expect(await vault.feeReserves(dai.address)).eq("27996800000000000000") // 27.9968

    await expect(router.connect(user0).swap([usdg.address, dai.address, btc.address], expandDecimals(20000, 18), "34000000", user0.address))
      .to.be.revertedWith("Router: insufficient amountOut")

    const tx = await router.connect(user0).swap([usdg.address, dai.address, btc.address], expandDecimals(20000, 18), "33000000", user0.address)
    await reportGasUsed(provider, tx, "swap gas used")
    expect(await usdg.balanceOf(user0.address)).eq("69792003200000000000000") // 69792.0032
    expect(await btc.balanceOf(user0.address)).eq("33220040") // 0.3322004 BTC
  })

  it("swap, increasePosition", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await busdPriceFeed.setLatestAnswer(toChainlinkPrice(1))

    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    const bnbBusd = await deployContract("PancakePair", [])
    await bnbBusd.setReserves(expandDecimals(1000, 18), expandDecimals(300 * 1000, 18))

    const ethBnb = await deployContract("PancakePair", [])
    await ethBnb.setReserves(expandDecimals(800, 18), expandDecimals(100, 18))

    const btcBnb = await deployContract("PancakePair", [])
    await btcBnb.setReserves(expandDecimals(10, 18), expandDecimals(2000, 18))

    await vaultPriceFeed.setTokens(btc.address, eth.address, bnb.address)
    await vaultPriceFeed.setPairs(bnbBusd.address, ethBnb.address, btcBnb.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).approve(router.address, expandDecimals(1, 8))
    await router.connect(user0).swap([btc.address, usdg.address], expandDecimals(1, 8), expandDecimals(59000, 18), user0.address)

    await dai.mint(user0.address, expandDecimals(200, 18))
    await dai.connect(user0).approve(router.address, expandDecimals(200, 18))

    await expect(router.connect(user0).increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), "333333", toUsd(1200), true, toNormalizedPrice(60000)))
      .to.be.revertedWith("Router: insufficient amountOut")

    await expect(router.connect(user0).increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), "332333", toUsd(1200), true, toNormalizedPrice(60000 - 1)))
      .to.be.revertedWith("Router: mark price higher than limit")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))

    await vaultPriceFeed.setPriceSampleSpace(2)

    const tx = await router.connect(user0).increasePosition([dai.address, btc.address], btc.address, expandDecimals(200, 18), "332333", toUsd(1200), true, toNormalizedPrice(60000))
    await reportGasUsed(provider, tx, "increasePosition gas used")
  })
})
