const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("./helpers")

use(solidity)

describe("Vault.liquidateLongPosition", function () {
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

    await vault.enableMinting()
  })

  it("liquidate long", async () => {
    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, bnb.address, true, user2.address))
      .to.be.revertedWith("Vault: mismatched tokens")
    await expect(vault.connect(user0).liquidatePosition(user0.address, dai.address, dai.address, true, user2.address))
      .to.be.revertedWith("Vault: _collateralToken must not be a stableToken")
    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.revertedWith("Vault: empty position")

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(false)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500))

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq("5487804878048780487804878048780") // ~5.48
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(false)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("4390243902439024390243902439024") // ~4.39
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(false)

    await expect(vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.revertedWith("Vault: position cannot be liquidated")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(38700))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("5048780487804878048780487804878") // ~5.04
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(true)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    expect(await vault.feeReserves(btc.address)).eq(969)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
    expect(await btc.balanceOf(user2.address)).eq(0)

    const tx = await vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address)
    await reportGasUsed(provider, tx, "liquidatePosition gas used")

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(1175)
    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(262756 - 219)
    expect(await btc.balanceOf(user2.address)).eq(11494) // 0.00011494 * 43500 => ~5
  })

  it("excludes AMM price", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await busdPriceFeed.setLatestAnswer(toChainlinkPrice(1))

    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))
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
    await busd.mint(bnbBusdPair.address, expandDecimals(1000 * 1000, 18))

    await btc.mint(btcBnbPair.address, expandDecimals(25, 8))
    await bnb.mint(btcBnbPair.address, expandDecimals(1000, 18))

    const pancakeFactory = await deployContract("PancakeFactory", [[
        btc.address,
        bnb.address,
        busd.address,
        bnbBusdPair.address,
        btcBnbPair.address
    ]])

    const ammPriceFeed = await deployContract("AmmPriceFeed", [])
    await ammPriceFeed.initialize([
        vault.address,
        pancakeFactory.address,
        btc.address,
        eth.address,
        bnb.address,
        busd.address
    ])

    await vault.setAmmPriceFeed(ammPriceFeed.address)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(false)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(43500))

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("2195121951219512195121951219512") // ~2.195
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(false)

    await btc.mint(btcBnbPair.address, expandDecimals(1, 8))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("5572232645403377110694183864916") // ~5.572
    expect((await vault.validateLiquidation(user0.address, btc.address, btc.address, true, false))[0]).eq(true)

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    expect(await vault.feeReserves(btc.address)).eq(969)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
    expect(await btc.balanceOf(user2.address)).eq(0)

    await expect(vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.revertedWith("Vault: position cannot be liquidated")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(38700))

    const tx = await vault.liquidatePosition(user0.address, btc.address, btc.address, true, user2.address)
    await reportGasUsed(provider, tx, "liquidatePosition gas used")

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(1175)
    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(262756 - 219)
    expect(await btc.balanceOf(user2.address)).eq(11494) // 0.00011494 * 43500 => ~5
  })
})
