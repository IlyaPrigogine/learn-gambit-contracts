const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")

use(solidity)

describe("Vault.sellUSDG", function () {
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

  it("sellUSDG", async () => {
    await expect(vault.connect(user0).sellUSDG(bnb.address, user1.address))
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

    await bnb.mint(user0.address, 100)

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    expect(await bnb.balanceOf(user0.address)).eq(100)
    await bnb.connect(user0).transfer(vault.address, 100)
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)
    expect(await usdg.balanceOf(user0.address)).eq(29700)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
    expect(await bnb.balanceOf(user0.address)).eq(0)

    await expect(vault.connect(user0).sellUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: invalid usdgAmount")

    await usdg.connect(user0).transfer(vault.address, 15000)

    await expect(vault.connect(user0).sellUSDG(btc.address, user1.address))
      .to.be.revertedWith("Vault: empty collateral")

    const tx = await vault.connect(user0).sellUSDG(bnb.address, user1.address)
    await reportGasUsed(provider, tx, "sellUSDG gas used")
    expect(await usdg.balanceOf(user0.address)).eq(29700 - 15000)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(2)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700 - 15000)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1 - 45)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(45 - 1) // (15000 / 29700) * 99 => 50, 50 * 0.9 => 45
  })

  it("sellUSDG after a price increase", async () => {
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

    await bnb.mint(user0.address, 100)

    expect(await usdg.balanceOf(user0.address)).eq(0)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(0)
    expect(await vault.usdgAmounts(bnb.address)).eq(0)
    expect(await vault.poolAmounts(bnb.address)).eq(0)
    expect(await bnb.balanceOf(user0.address)).eq(100)
    await bnb.connect(user0).transfer(vault.address, 100)
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    expect(await usdg.balanceOf(user0.address)).eq(29700)
    expect(await usdg.balanceOf(user1.address)).eq(0)

    expect(await vault.feeReserves(bnb.address)).eq(1)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1)
    expect(await bnb.balanceOf(user0.address)).eq(0)

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))

    await usdg.connect(user0).transfer(vault.address, 15000)
    await vault.connect(user0).sellUSDG(bnb.address, user1.address)

    expect(await usdg.balanceOf(user0.address)).eq(29700 - 15000)
    expect(await usdg.balanceOf(user1.address)).eq(0)
    expect(await vault.feeReserves(bnb.address)).eq(2)
    expect(await vault.usdgAmounts(bnb.address)).eq(29700 - 15000)
    expect(await vault.poolAmounts(bnb.address)).eq(100 - 1 - 25)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq(25 - 1) // (15000 / 600) => 25
  })
})
