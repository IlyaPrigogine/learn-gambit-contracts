const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getDaiConfig, getBnbConfig, getBtcConfig } = require("./helpers")

use(solidity)

describe("Vault.getPrice", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let router
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
  let usdc
  let usdcPriceFeed
  let distributor0
  let yieldTracker0

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    usdc = await deployContract("Token", [])
    usdcPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

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
      true, // _isStrictStable
      false // _isShortable
    )

    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(1, 30))
    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.1))
    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(11, 29))

    await vault.setMaxStrictPriceDeviation(expandDecimals(1, 29))
    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(1, 30))

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(1.11))
    expect(await vault.getPrice(usdc.address, true)).eq(expandDecimals(111, 28))

    expect(await vault.getPrice(usdc.address, false)).eq(expandDecimals(1, 30))

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(0.9))
    expect(await vault.getPrice(usdc.address, false)).eq(expandDecimals(1, 30))

    await usdcPriceFeed.setLatestAnswer(toChainlinkPrice(0.89))
    expect(await vault.getPrice(usdc.address, false)).eq(expandDecimals(89, 28))
  })

  it("includes AMM price", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(80000))
    await busdPriceFeed.setLatestAnswer(toChainlinkPrice(1))

    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))
    await vault.setTokenConfig(
        busd.address, // _token
        busdPriceFeed.address, // _priceFeed
        8, // _priceDecimals
        18, // _tokenDecimals
        9000, // _redemptionBps
        75, // _minProfitBps
        true, // _isStable
        true, // _isStrictStable
        false // _isShortable
    )

    const bnbBusdPair = newWallet()
    const btcBnbPair = newWallet()

    await bnb.mint(bnbBusdPair.address, expandDecimals(1 * 1000, 18))
    await busd.mint(bnbBusdPair.address, expandDecimals(300 * 1000, 18))

    await btc.mint(btcBnbPair.address, expandDecimals(10, 8))
    await bnb.mint(btcBnbPair.address, expandDecimals(2000, 18))

    const pancakeFactory = await deployContract("PancakeFactory", [[
        btc.address,
        bnb.address,
        busd.address,
        bnbBusdPair.address,
        btcBnbPair.address
    ]])

    const ammPriceFeed = await deployContract("AmmPriceFeed", [[
        vault.address,
        pancakeFactory.address,
        btc.address,
        eth.address,
        bnb.address,
        busd.address
    ]])

    expect(await vault.getPrice(bnb.address, false)).eq(toNormalizedPrice(600))
    expect(await vault.getPrice(btc.address, false)).eq(toNormalizedPrice(80000))

    await vault.setAmmPriceFeed(ammPriceFeed.address)

    expect(await vault.getPrice(bnb.address, false)).eq(toNormalizedPrice(300))
    expect(await vault.getPrice(btc.address, false)).eq(toNormalizedPrice(60000))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(200))
    expect(await vault.getPrice(bnb.address, false)).eq(toNormalizedPrice(200))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000))
    expect(await vault.getPrice(btc.address, false)).eq(toNormalizedPrice(50000))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(250))
    expect(await vault.getPrice(bnb.address, false)).eq(toNormalizedPrice(200))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(280))
    expect(await vault.getPrice(bnb.address, true)).eq(toNormalizedPrice(300))
  })
})
