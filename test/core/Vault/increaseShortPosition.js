const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")

use(solidity)

describe("Vault.increaseShortPosition", function () {
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

  it("increasePosition short validations", async () => {
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
    await expect(vault.connect(user1).increasePosition(user0.address, dai.address, btc.address, 0, false))
      .to.be.revertedWith("Vault: invalid msg.sender")
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")
    await expect(vault.connect(user0).increasePosition(user0.address, bnb.address, bnb.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _collateralToken must be a stableToken")
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
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, dai.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: _indexToken must not be a stableToken")

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: invalid price feed")

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

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(50000))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: insufficient collateral for fees")
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, 0, false))
      .to.be.revertedWith("Vault: invalid position.size")

    await dai.mint(user0.address, expandDecimals(1000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(9, 17))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: insufficient collateral for fees")

    await dai.connect(user0).transfer(vault.address, expandDecimals(4, 18))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(1000), false))
      .to.be.revertedWith("Vault: losses exceed collateral")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
      .to.be.revertedWith("Vault: liquidation fees exceed collateral")

    await dai.connect(user0).transfer(vault.address, expandDecimals(6, 18))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(8), false))
      .to.be.revertedWith("Vault: _size must be more than _collateral")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(600), false))
      .to.be.revertedWith("Vault: maxLeverage exceeded")

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
      .to.be.revertedWith("Vault: reserve exceeds pool")
  })

  it("increasePosition short", async () => {
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
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await dai.mint(user0.address, expandDecimals(1000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(100, 18))

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(99), false))
      .to.be.revertedWith("Vault: _size must be more than _collateral")

    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.feeReserves(dai.address)).eq(0)
    expect(await vault.usdgAmounts(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq(0)

    expect(await vault.getRedemptionCollateralUsd(dai.address)).eq(0)
    await vault.buyUSDG(dai.address, user1.address)
    expect(await vault.getRedemptionCollateralUsd(dai.address)).eq(toUsd(99.7))

    expect(await vault.feeReserves(dai.address)).eq("300000000000000000") // 0.30
    expect(await vault.usdgAmounts(dai.address)).eq("99700000000000000000") // 99.7
    expect(await vault.poolAmounts(dai.address)).eq("99700000000000000000") // 99.7

    await dai.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(100), false))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)

    let position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    const tx = await vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)
    await reportGasUsed(provider, tx, "increasePosition gas used")

    expect(await vault.poolAmounts(dai.address)).eq("99700000000000000000")
    expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
    expect(await vault.guaranteedUsd(dai.address)).eq(0)
    expect(await vault.getRedemptionCollateralUsd(dai.address)).eq(toUsd(99.7))

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount

    expect(await vault.feeReserves(dai.address)).eq("390000000000000000") // 0.39
    expect(await vault.usdgAmounts(dai.address)).eq("99700000000000000000") // 99.7
    expect(await vault.poolAmounts(dai.address)).eq("99700000000000000000") // 99.7
  })
})
