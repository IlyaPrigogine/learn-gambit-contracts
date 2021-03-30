const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")

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

    await vault.initialize(router.address, usdg.address, expandDecimals(200 * 1000, 18), toUsd(5), 600)

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])
  })

  it("buyUSDG", async () => {
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

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

    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: invalid tokenAmount")

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    await bnb.mint(user0.address, 100)
    await bnb.connect(user0).transfer(vault.address, 100)
    const tx = await vault.connect(user0).buyUSDG(bnb.address, user1.address)
    await reportGasUsed(provider, tx, "buyUSDG gas used")
    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(29700)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
  })

  it("buyUSDG uses min price", async () => {
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(200))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(250))

    await vault.setTokenConfig(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      false // _isStable
    )

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
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

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

  it("buyUSDG adjusts for decimals", async () => {
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
