const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getDaiConfig } = require("./helpers")

use(solidity)

describe("Vault.getPrice", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let router
  let bnb
  let bnbPriceFeed
  let dai
  let daiPriceFeed
  let usdc
  let usdcPriceFeed
  let distributor0
  let yieldTracker0

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    usdc = await deployContract("Token", [])
    usdcPriceFeed = await deployContract("PriceFeed", [])

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

  it("getPrice", async () => {
    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))
    expect(await vault.getPrice(dai.address, true)).eq(expandDecimals(1, 30))

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1.1))
    expect(await vault.getPrice(dai.address, true)).eq(expandDecimals(11, 29))

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(
      usdc.address, // _token
      usdcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      18, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      true, // _isStable
      true // _isStrictStable
    )

    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(1, 30))
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.1))
    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(11, 29))

    await vault.setMaxStrictPriceDeviation(expandDecimals(1, 29))
    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(1, 30))

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.11))
    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(111, 28))
  })

  it("includes AMM price", async () => {

  })
})
