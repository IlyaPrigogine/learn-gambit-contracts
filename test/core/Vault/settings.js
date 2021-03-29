const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")

use(solidity)

describe("Vault.settings", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let dai
  let daiPriceFeed
  let distributor0
  let yieldTracker0

  beforeEach(async () => {
    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    await vault.initialize(usdg.address, expandDecimals(200 * 1000, 18), toUsd(5), 600)

    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

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
    expect(await vault.usdg()).eq(usdg.address)
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
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

  it("setTokenConfig", async () => {
    const params = [
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      false // _isStable
    ]

    await expect(vault.connect(user0).setTokenConfig(...params))
      .to.be.revertedWith("Vault: forbidden")

    await expect(vault.setTokenConfig(...params))
      .to.be.revertedWith("Vault: could not fetch price")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await vault.setTokenConfig(...params)

    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.priceFeeds(bnb.address)).eq(bnbPriceFeed.address)
    expect(await vault.priceDecimals(bnb.address)).eq(8)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(9000)
    expect(await vault.tokenDecimals(bnb.address)).eq(18)
    expect(await vault.stableTokens(bnb.address)).eq(false)
  })

  it("clearTokenConfig", async () => {
    const params = [
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      false // _isStable
    ]

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await vault.setTokenConfig(...params)

    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.priceFeeds(bnb.address)).eq(bnbPriceFeed.address)
    expect(await vault.priceDecimals(bnb.address)).eq(8)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(9000)
    expect(await vault.tokenDecimals(bnb.address)).eq(18)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await expect(vault.connect(user0).clearTokenConfig(bnb.address))
      .to.be.revertedWith("Vault: forbidden")

    await vault.clearTokenConfig(bnb.address)

    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await expect(vault.clearTokenConfig(bnb.address))
      .to.be.revertedWith("Vault: token not whitelisted")
  })
})
