const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault } = require("./helpers")

use(solidity)

describe("Vault.settings", function () {
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

  it("inits", async () => {
    expect(await usdg.gov()).eq(wallet.address)
    expect(await usdg.vaults(vault.address)).eq(true)
    expect(await usdg.vaults(user0.address)).eq(false)

    expect(await vault.gov()).eq(wallet.address)
    expect(await vault.isInitialized()).eq(true)
    expect(await vault.router()).eq(router.address)
    expect(await vault.usdg()).eq(usdg.address)
    expect(await vault.maxUsdgBatchSize()).eq(expandDecimals(600 * 1000, 18))
    expect(await vault.maxUsdgBuffer()).eq(expandDecimals(100 * 1000, 18))
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
    expect(await vault.fundingRateFactor()).eq(600)

    expect(await vault.isMintingEnabled()).eq(false)
  })

  it("enableMinting", async () => {
    await expect(vault.connect(user0).enableMinting())
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    expect(await vault.isMintingEnabled()).eq(false)
    await vault.connect(user0).enableMinting()
    expect(await vault.isMintingEnabled()).eq(true)
  })

  it("setGov", async () => {
    await expect(vault.connect(user0).setGov(user1.address))
      .to.be.revertedWith("Vault: forbidden")

    expect(await vault.gov()).eq(wallet.address)

    await vault.setGov(user0.address)
    expect(await vault.gov()).eq(user0.address)

    await vault.connect(user0).setGov(user1.address)
    expect(await vault.gov()).eq(user1.address)
  })

  it("setAmmPriceFeed", async () => {
    await expect(vault.connect(user0).setAmmPriceFeed(user1.address))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    expect(await vault.ammPriceFeed()).eq(ethers.constants.AddressZero)
    await vault.connect(user0).setAmmPriceFeed(user1.address)
    expect(await vault.ammPriceFeed()).eq(user1.address)
  })

  it("setMaxUsdg", async () => {
    await expect(vault.connect(user0).setMaxUsdg(500, 1000))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    expect(await vault.maxUsdgBatchSize()).eq(expandDecimals(600 * 1000, 18))
    expect(await vault.maxUsdgBuffer()).eq(expandDecimals(100 * 1000, 18))
    await vault.connect(user0).setMaxUsdg(500, 1000)
    expect(await vault.maxUsdgBatchSize()).eq(500)
    expect(await vault.maxUsdgBuffer()).eq(1000)
  })

  it("setMaxLeverage", async () => {
    await expect(vault.connect(user0).setMaxLeverage(10000))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    await expect(vault.connect(user0).setMaxLeverage(10000))
      .to.be.revertedWith("Vault: invalid _maxLeverage")

    expect(await vault.maxLeverage()).eq(50 * 10000)
    await vault.connect(user0).setMaxLeverage(10001)
    expect(await vault.maxLeverage()).eq(10001)
  })

  it("setPriceSampleSpace", async () => {
    await expect(vault.connect(user0).setPriceSampleSpace(0))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    await expect(vault.connect(user0).setPriceSampleSpace(0))
      .to.be.revertedWith("Vault: invalid _priceSampleSpace")

    expect(await vault.priceSampleSpace()).eq(3)
    await vault.connect(user0).setPriceSampleSpace(1)
    expect(await vault.priceSampleSpace()).eq(1)
  })

  it("setFees", async () => {
    await expect(vault.connect(user0).setFees(501, 501, 501, toUsd(101)))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    await expect(vault.connect(user0).setFees(501, 501, 501, toUsd(101)))
      .to.be.revertedWith("Vault: invalid _swapFeeBasisPoints")

    await expect(vault.connect(user0).setFees(400, 501, 501, toUsd(101)))
      .to.be.revertedWith("Vault: invalid _stableSwapFeeBasisPoints")

    await expect(vault.connect(user0).setFees(400, 401, 501, toUsd(101)))
      .to.be.revertedWith("Vault: invalid _marginFeeBasisPoints")

    await expect(vault.connect(user0).setFees(400, 401, 402, toUsd(101)))
      .to.be.revertedWith("Vault: invalid _liquidationFeeUsd")

    expect(await vault.swapFeeBasisPoints()).eq(30)
    expect(await vault.stableSwapFeeBasisPoints()).eq(4)
    expect(await vault.marginFeeBasisPoints()).eq(10)
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
    await vault.connect(user0).setFees(400, 401, 402, toUsd(100))
    expect(await vault.swapFeeBasisPoints()).eq(400)
    expect(await vault.stableSwapFeeBasisPoints()).eq(401)
    expect(await vault.marginFeeBasisPoints()).eq(402)
    expect(await vault.liquidationFeeUsd()).eq(toUsd(100))
  })

  it("setFundingRate", async () => {
    await expect(vault.connect(user0).setFundingRate(59 * 60, 10001))
      .to.be.revertedWith("Vault: forbidden")

    await vault.setGov(user0.address)

    await expect(vault.connect(user0).setFundingRate(59 * 60, 10001))
      .to.be.revertedWith("Vault: invalid _fundingInterval")

    await expect(vault.connect(user0).setFundingRate(60 * 60, 10001))
      .to.be.revertedWith("Vault: invalid _fundingRateFactor")

    expect(await vault.fundingInterval()).eq(8 * 60 * 60)
    expect(await vault.fundingRateFactor()).eq(600)
    await vault.connect(user0).setFundingRate(60 * 60, 10000)
    expect(await vault.fundingInterval()).eq(60 * 60)
    expect(await vault.fundingRateFactor()).eq(10000)
  })

  it("setTokenConfig", async () => {
    const params = [
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      true, // _isStable
      false // _isStrictStable
    ]

    await expect(vault.connect(user0).setTokenConfig(...params))
      .to.be.revertedWith("Vault: forbidden")

    await expect(vault.setTokenConfig(...params))
      .to.be.revertedWith("Vault: could not fetch price")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    expect(await vault.whitelistedTokenCount()).eq(0)
    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)
    expect(await vault.strictStableTokens(bnb.address)).eq(false)

    await vault.setTokenConfig(...params)

    expect(await vault.whitelistedTokenCount()).eq(1)
    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.priceFeeds(bnb.address)).eq(bnbPriceFeed.address)
    expect(await vault.priceDecimals(bnb.address)).eq(8)
    expect(await vault.tokenDecimals(bnb.address)).eq(18)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(9000)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(75)
    expect(await vault.stableTokens(bnb.address)).eq(true)
    expect(await vault.strictStableTokens(bnb.address)).eq(false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))

    await vault.setTokenConfig(
      dai.address,
      daiPriceFeed.address,
      1,
      2,
      5000,
      50,
      false,
      true
    )

    expect(await vault.whitelistedTokenCount()).eq(2)
    expect(await vault.whitelistedTokens(dai.address)).eq(true)
    expect(await vault.priceFeeds(dai.address)).eq(daiPriceFeed.address)
    expect(await vault.priceDecimals(dai.address)).eq(1)
    expect(await vault.tokenDecimals(dai.address)).eq(2)
    expect(await vault.redemptionBasisPoints(dai.address)).eq(5000)
    expect(await vault.minProfitBasisPoints(dai.address)).eq(50)
    expect(await vault.stableTokens(dai.address)).eq(false)
    expect(await vault.strictStableTokens(dai.address)).eq(true)

    await vault.setTokenConfig(
      dai.address,
      daiPriceFeed.address,
      10,
      20,
      11000,
      10,
      true,
      true
    )

    expect(await vault.whitelistedTokenCount()).eq(2)
    expect(await vault.whitelistedTokens(dai.address)).eq(true)
    expect(await vault.priceFeeds(dai.address)).eq(daiPriceFeed.address)
    expect(await vault.priceDecimals(dai.address)).eq(10)
    expect(await vault.tokenDecimals(dai.address)).eq(20)
    expect(await vault.redemptionBasisPoints(dai.address)).eq(11000)
    expect(await vault.minProfitBasisPoints(dai.address)).eq(10)
    expect(await vault.stableTokens(dai.address)).eq(true)
    expect(await vault.strictStableTokens(dai.address)).eq(true)
  })

  it("clearTokenConfig", async () => {
    const params = [
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      true, // _isStable
      true // _isStrictStable
    ]

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    expect(await vault.whitelistedTokenCount()).eq(0)
    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)
    expect(await vault.strictStableTokens(bnb.address)).eq(false)

    await vault.setTokenConfig(...params)

    expect(await vault.whitelistedTokenCount()).eq(1)
    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.priceFeeds(bnb.address)).eq(bnbPriceFeed.address)
    expect(await vault.priceDecimals(bnb.address)).eq(8)
    expect(await vault.tokenDecimals(bnb.address)).eq(18)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(9000)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(75)
    expect(await vault.stableTokens(bnb.address)).eq(true)
    expect(await vault.strictStableTokens(bnb.address)).eq(true)

    await expect(vault.connect(user0).clearTokenConfig(bnb.address))
      .to.be.revertedWith("Vault: forbidden")

    await vault.clearTokenConfig(bnb.address)

    expect(await vault.whitelistedTokenCount()).eq(0)
    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.minProfitBasisPoints(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)
    expect(await vault.strictStableTokens(bnb.address)).eq(false)

    await expect(vault.clearTokenConfig(bnb.address))
      .to.be.revertedWith("Vault: token not whitelisted")
  })

  it("addRouter", async () => {
    expect(await vault.approvedRouters(user0.address, user1.address)).eq(false)
    await vault.connect(user0).addRouter(user1.address)
    expect(await vault.approvedRouters(user0.address, user1.address)).eq(true)
  })

  it("removeRouter", async () => {
    expect(await vault.approvedRouters(user0.address, user1.address)).eq(false)
    await vault.connect(user0).addRouter(user1.address)
    expect(await vault.approvedRouters(user0.address, user1.address)).eq(true)
    await vault.connect(user0).removeRouter(user1.address)
    expect(await vault.approvedRouters(user0.address, user1.address)).eq(false)
  })
})
