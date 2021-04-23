const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")

use(solidity)

describe("Vault.buyUSDG", function () {
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
  })

  it("buyUSDG", async () => {
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address, { gasPrice: "11000000000" }))
      .to.be.revertedWith("Vault: maxGasPrice exceeded")

    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: minting not enabled")

    await expect(vault.buyUSDG(bnb.address, wallet.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await vault.enableMinting()

    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)

    await bnb.mint(user0.address, 100)
    await bnb.connect(user0).transfer(vault.address, 100)
    const tx = await vault.connect(user0).buyUSDG(bnb.address, user1.address, { gasPrice: "10000000000" })
    await reportGasUsed(provider, tx, "buyUSDG gas used")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(29700)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
  })

  it("buyUSDG allows gov to mint", async () => {
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: minting not enabled")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await bnb.mint(wallet.address, 100)
    await bnb.transfer(vault.address, 100)

    expect(await usdg.balanceOf(wallet.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)

    await vault.buyUSDG(bnb.address, wallet.address)

    expect(await usdg.balanceOf(wallet.address)).eq(29700)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
  })

  it("buyUSDG caps mint amount", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await vault.enableMinting()

    expect(await vault.getMaxUsdgAmount()).eq(expandDecimals(600 * 1000, 18))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    expect(await vault.getMaxUsdgAmount()).eq(expandDecimals(300 * 1000, 18))

    await bnb.mint(user0.address, expandDecimals(900, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(900, 18))

    expect(await usdg.balanceOf(wallet.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)

    await vault.connect(user0).buyUSDG(bnb.address, user1.address)

    expect(await usdg.balanceOf(wallet.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq("269190000000000000000000") // 269,190 USDG, 810 fee
    expect(await vault.feeReserves(bnb.address)).eq("2700000000000000000") // 2.7, 900 * 0.3%
    expect(await vault.usdgAmounts(bnb.address)).eq("269190000000000000000000") // 269,190
    expect(await vault.poolAmounts(bnb.address)).eq("897300000000000000000") // 897.3
    expect(await usdg.totalSupply()).eq("269190000000000000000000")

    await bnb.mint(user0.address, expandDecimals(200, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(200, 18))

    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: max USDG exceeded")

    await btc.mint(user0.address, expandDecimals(2, 8))
    await btc.connect(user0).transfer(vault.address, expandDecimals(2, 8))

    await vault.connect(user0).buyUSDG(btc.address, user1.address)
    expect(await vault.usdgAmounts(btc.address)).eq("119640000000000000000000") // 119,640
    expect(await usdg.totalSupply()).eq("388830000000000000000000") // 388,830

    expect(await vault.getMaxUsdgAmount()).eq(expandDecimals(300 * 1000, 18))

    await btc.mint(user0.address, expandDecimals(2, 8))
    await btc.connect(user0).transfer(vault.address, expandDecimals(2, 8))

    await vault.connect(user0).buyUSDG(btc.address, user1.address)
    expect(await vault.usdgAmounts(btc.address)).eq("239280000000000000000000") // 239,280
    expect(await usdg.totalSupply()).eq("508470000000000000000000") // 508,470

    expect(await vault.getMaxUsdgAmount()).eq(expandDecimals(600 * 1000, 18)) // 269,190

    expect(await vault.usdgAmounts(bnb.address)).eq("269190000000000000000000") // 269,190
    expect(await vault.poolAmounts(bnb.address)).eq("897300000000000000000") // 897.3

    await vault.connect(user0).buyUSDG(bnb.address, user1.address)

    expect(await vault.usdgAmounts(bnb.address)).eq("329010000000000000000000") // 329,010
    expect(await vault.poolAmounts(bnb.address)).eq("1096700000000000000000") // 1096.7
  })

  it("buyUSDG uses min price", async () => {
    await vault.enableMinting()
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(200))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(250))

    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await bnb.mint(user0.address, 100)
    await bnb.connect(user0).transfer(vault.address, 100)
    await vault.connect(user0).buyUSDG(bnb.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(19800)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdgAmounts(bnb.address)).eq(19800)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
  })

  it("buyUSDG updates fees", async () => {
    await vault.enableMinting()
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await bnb.mint(user0.address, 10000)
    await bnb.connect(user0).transfer(vault.address, 10000)
    await vault.connect(user0).buyUSDG(bnb.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(9970 * 300)
    expect(await vault.feeReserves(bnb.address)).eq(30)
    expect(await vault.usdgAmounts(bnb.address)).eq(9970 * 300)
    expect(await vault.poolAmounts(bnb.address)).eq(10000 - 30)
  })

  it("buyUSDG uses stableSwapFeeBasisPoints", async () => {
    await vault.enableMinting()
    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await dai.mint(user0.address, expandDecimals(10000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
    await vault.connect(user0).buyUSDG(dai.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(expandDecimals(10000 - 4, 18))
    expect(await vault.feeReserves(dai.address)).eq(expandDecimals(4, 18))
    expect(await vault.usdgAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
    expect(await vault.poolAmounts(dai.address)).eq(expandDecimals(10000 - 4, 18))
  })

  it("buyUSDG adjusts for decimals", async () => {
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await vault.enableMinting()

    await expect(vault.connect(user0).buyUSDG(btc.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
    await vault.connect(user0).buyUSDG(btc.address, user1.address)
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await vault.feeReserves(btc.address)).eq(300000)
    expect(await usdg.balanceOf(user1.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18))) // 0.3% of 60,000 => 180
    expect(await vault.usdgAmounts(btc.address)).eq(expandDecimals(60000, 18).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub(300000))
  })
})
