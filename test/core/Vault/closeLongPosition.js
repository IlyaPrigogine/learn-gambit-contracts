const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")

use(solidity)

describe("Vault.closeLongPosition", function () {
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

  it("close long position", async () => {
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

    await btc.mint(user1.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 250000) // 0.0025 BTC => 100 USD
    await vault.buyUSDG(btc.address, user1.address)

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user1).transfer(vault.address, 25000) // 0.00025 BTC => 10 USD
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(110), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(90), true)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000) // reserveAmount, 0.00225 * 40,000 => 90

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(45100))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100))

    expect(await vault.feeReserves(btc.address)).eq(969)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(80.09))
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219)
    expect(await btc.balanceOf(user2.address)).eq(0)

    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(9))

    const tx = await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(4), toUsd(90), true, user2.address)
    await reportGasUsed(provider, tx, "decreasePosition gas used")

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(0) // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(969 + 191) // 0.00000191 * 47100 => ~0.09 USD
    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 219 - 39957 - 191) // 0.00040148 * 47100 => ~18.9 USD
    expect(await btc.balanceOf(user2.address)).eq(39957) // 0.00039957 * 47100 => 18.82 USD
  })
})
