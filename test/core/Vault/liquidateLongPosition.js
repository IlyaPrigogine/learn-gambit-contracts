const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")

use(solidity)

describe("Vault.liquidateLongPosition", function () {
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

  it("liquidate long", async () => {
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
    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, bnb.address, true, user2.address))
      .to.be.revertedWith("Vault: mismatched tokens")
    await expect(vault.connect(user0).liquidatePosition(user0.address, dai.address, dai.address, true, user2.address))
      .to.be.revertedWith("Vault: _collateralToken must not be a stableToken")
    await expect(vault.connect(user0).liquidatePosition(user0.address, btc.address, btc.address, true, user2.address))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await vault.setTokenConfig(
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      8, // _tokenDecimals
      9000, // _redemptionBps
      75, // _minProfitBps
      false // _isStable
    )

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
})
