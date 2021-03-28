const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

describe("Vault", function () {
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
    expect(await usdg.vault()).eq(vault.address)

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

  it("swap", async () => {
    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenIn not whitelisted")

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

    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenOut not whitelisted")

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

    await bnb.mint(user0.address, expandDecimals(200, 18))
    await btc.mint(user0.address, expandDecimals(1, 8))

    await bnb.connect(user0).transfer(vault.address, expandDecimals(200, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await btc.connect(user0).transfer(vault.address, expandDecimals(1, 8))
    await vault.connect(user0).buyUSDG(btc.address, user0.address)

    expect(await usdg.balanceOf(user0.address)).eq(expandDecimals(120000, 18).sub(expandDecimals(360, 18))) // 120,000 * 0.3% => 360

    expect(await vault.feeReserves(bnb.address)).eq("600000000000000000") // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(bnb.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18))) // 60,000 * 0.3% => 180
    expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(200, 18).sub("600000000000000000"))

    expect(await vault.feeReserves(btc.address)).eq("300000") // 1 * 0.3% => 0.003
    expect(await vault.usdgAmounts(btc.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub("300000"))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(90000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(100000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(80000))

    await bnb.mint(user1.address, expandDecimals(200, 18))
    await bnb.connect(user1).transfer(vault.address, expandDecimals(200, 18))

    expect(await btc.balanceOf(user1.address)).eq(0)
    expect(await btc.balanceOf(user2.address)).eq(0)
    const tx = await vault.connect(user1).swap(bnb.address, btc.address, user2.address)
    await reportGasUsed(provider, tx, "swap gas used")

    expect(await btc.balanceOf(user1.address)).eq(0)
    expect(await btc.balanceOf(user2.address)).eq(expandDecimals(8, 7).sub("240000")) // 0.8 - 0.0024

    expect(await vault.feeReserves(bnb.address)).eq("600000000000000000") // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(bnb.address)).eq(expandDecimals(200 * 400, 18).add(expandDecimals(200 * 300, 18)).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(200, 18).add(expandDecimals(200, 18)).sub("600000000000000000"))

    expect(await vault.feeReserves(btc.address)).eq("540000") // 1 * 0.3% => 0.003, 0.8 * 0.3% => 0.0024
    expect(await vault.usdgAmounts(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub("300000").sub(expandDecimals(8, 7)))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(450))

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)
    await usdg.connect(user0).transfer(vault.address, expandDecimals(100000, 18))
    await vault.sellUSDG(bnb.address, user3.address)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(expandDecimals(200, 18).sub(expandDecimals(6, 17)))

    await usdg.connect(user0).transfer(vault.address, expandDecimals(10000, 18))

    await expect(vault.sellUSDG(btc.address, user3.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")
  })

  it("increasePosition long validations", async () => {
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
    await expect(vault.connect(user1).increasePosition(user0.address, btc.address, btc.address, 0, true))
      .to.be.revertedWith("Vault: invalid msg.sender")
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, bnb.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: mismatched tokens")
    await expect(vault.connect(user0).increasePosition(user0.address, dai.address, dai.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: _collateralToken must not be a stableToken")
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")

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

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: insufficient collateral for fees")
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, 0, true))
      .to.be.revertedWith("Vault: invalid position.size")

    await btc.mint(user0.address, expandDecimals(1, 8))
    await btc.connect(user0).transfer(vault.address, 2500 - 1)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: insufficient collateral for fees")

    await btc.connect(user0).transfer(vault.address, 1)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: losses exceed collateral")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: fees exceed collateral")

    await btc.connect(user0).transfer(vault.address, 10000)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(1000), true))
      .to.be.revertedWith("Vault: liquidation fees exceed collateral")

    await btc.connect(user0).transfer(vault.address, 10000)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(500), true))
      .to.be.revertedWith("Vault: maxLeverage exceeded")

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(8), true))
      .to.be.revertedWith("Vault: _size must be more than _collateral")

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")
  })

  it("increasePosition long", async () => {
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

    await btc.mint(user0.address, expandDecimals(1, 8))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await btc.connect(user0).transfer(vault.address, 117500 - 1) // 0.001174 BTC => 47

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    expect(await vault.feeReserves(btc.address)).eq(0)
    expect(await vault.usdgAmounts(btc.address)).eq(0)
    expect(await vault.poolAmounts(btc.address)).eq(0)

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(0)
    await vault.buyUSDG(btc.address, user1.address)
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd("46.8584"))

    expect(await vault.feeReserves(btc.address)).eq(353) // (117500 - 1) * 0.3% => 353
    expect(await vault.usdgAmounts(btc.address)).eq("46858400000000000000") // (117500 - 1 - 353) * 40000
    expect(await vault.poolAmounts(btc.address)).eq(117500 - 1 - 353)

    await btc.connect(user0).transfer(vault.address, 117500 - 1)
    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(100), true))
      .to.be.revertedWith("Vault: reserve exceeds pool")

    await vault.buyUSDG(btc.address, user1.address)

    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd("93.7168"))

    expect(await vault.feeReserves(btc.address)).eq(353 * 2) // (117500 - 1) * 0.3% * 2
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2)

    await expect(vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true))
      .to.be.revertedWith("Vault: insufficient collateral for fees")

    await btc.connect(user0).transfer(vault.address, 22500)

    expect(await vault.reservedAmounts(btc.address)).eq(0)
    expect(await vault.guaranteedUsd(btc.address)).eq(0)

    let position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    const tx = await vault.connect(user0).increasePosition(user0.address, btc.address, btc.address, toUsd(47), true)
    await reportGasUsed(provider, tx, "increasePosition gas used")

    expect(await vault.poolAmounts(btc.address)).eq(256792)
    expect(await vault.reservedAmounts(btc.address)).eq(117500)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(47))
    expect(await vault.getRedemptionCollateralUsd(btc.address)).eq(toUsd(101.5704)) // (256792 - 117500) sats * 40000 => 51.7968, 47 / 40000 * 41000 => ~45.8536

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(47)) // size
    expect(position[1]).eq(toUsd(8.953)) // collateral, 0.000225 BTC => 9, 9 - 0.047 => 8.953
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(117500) // reserveAmount

    expect(await vault.feeReserves(btc.address)).eq(353 * 2 + 114) // fee is 0.047 USD => 0.00000114 BTC
    expect(await vault.usdgAmounts(btc.address)).eq("93716800000000000000") // (117500 - 1 - 353) * 40000 * 2
    expect(await vault.poolAmounts(btc.address)).eq((117500 - 1 - 353) * 2 + 22500)
  })

  it("decreasePosition long", async () => {
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
    await expect(vault.connect(user1).decreasePosition(user0.address, btc.address, btc.address, 0, 0, true, user2.address))
      .to.be.revertedWith("Vault: invalid msg.sender")
    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, bnb.address, 0, toUsd(1000), true, user2.address))
      .to.be.revertedWith("Vault: mismatched tokens")
    await expect(vault.connect(user0).decreasePosition(user0.address, dai.address, dai.address, 0, toUsd(1000), true, user2.address))
      .to.be.revertedWith("Vault: _collateralToken must not be a stableToken")
    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(1000), true, user2.address))
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

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(1000), true, user2.address))
      .to.be.revertedWith("Vault: empty position")

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
    let delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("2195121951219512195121951219512") // ~2.1951

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(46100))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("2195121951219512195121951219512") // ~2.1951

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(47100))
    delta = await vault.getPositionDelta(user0.address, btc.address, btc.address, true)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(9))

    let leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(90817) // ~9X leverage

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, 0, toUsd(100), true, user2.address))
      .to.be.revertedWith("Vault: position size exceeded")

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(10), toUsd(50), true, user2.address))
      .to.be.revertedWith("SafeMath: subtraction overflow")

    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(8.91), toUsd(50), true, user2.address))
      .to.be.revertedWith("Vault: liquidation fees exceed collateral")

    expect(await vault.feeReserves(btc.address)).eq(969)
    expect(await vault.reservedAmounts(btc.address)).eq(225000)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(90))
    expect(await vault.poolAmounts(btc.address)).eq(274250)
    expect(await btc.balanceOf(user2.address)).eq(0)

    const tx = await vault.connect(user0).decreasePosition(user0.address, btc.address, btc.address, toUsd(3), toUsd(50), true, user2.address)
    await reportGasUsed(provider, tx, "decreasePosition gas used")

    leverage = await vault.getPositionLeverage(user0.address, btc.address, btc.address, true)
    expect(leverage).eq(57887) // ~5.8X leverage

    position = await vault.getPosition(user0.address, btc.address, btc.address, true)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
    expect(position[2]).eq(toNormalizedPrice(41000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(225000 / 90 * 40) // reserveAmount, 0.00225 * 40,000 => 90
    expect(position[5]).eq(toUsd(5)) // pnl
    expect(position[6]).eq(true)

    expect(await vault.feeReserves(btc.address)).eq(969 + 106) // 0.00000106 * 45100 => ~0.05 USD
    expect(await vault.reservedAmounts(btc.address)).eq(225000 / 90 * 40)
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(40))
    expect(await vault.poolAmounts(btc.address)).eq(274250 - 16878 - 106 - 1)
    expect(await btc.balanceOf(user2.address)).eq(16878) // 0.00016878 * 47100 => 7.949538 USD
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
    expect(await vault.guaranteedUsd(btc.address)).eq(toUsd(90))
    expect(await vault.poolAmounts(btc.address)).eq(274250)
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
    expect(await vault.poolAmounts(btc.address)).eq(262756)
    expect(await btc.balanceOf(user2.address)).eq(11494) // 0.00011494 * 43500 => ~5
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

  it("decreasePosition short", async () => {
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
    await expect(vault.connect(user1).decreasePosition(user0.address, btc.address, btc.address, 0, 0, false, user2.address))
      .to.be.revertedWith("Vault: invalid msg.sender")
    await expect(vault.connect(user0).decreasePosition(user0.address, btc.address, bnb.address, 0, toUsd(1000), false, user2.address))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")
    await expect(vault.connect(user0).decreasePosition(user0.address, bnb.address, btc.address, 0, toUsd(1000), false, user2.address))
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
    await expect(vault.connect(user0).decreasePosition(user0.address, dai.address, dai.address, 0, toUsd(1000), false, user2.address))
      .to.be.revertedWith("Vault: _indexToken must not be a stableToken")

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

    await expect(vault.connect(user0).decreasePosition(user0.address, dai.address, btc.address, 0, toUsd(1000), false, user2.address))
      .to.be.revertedWith("Vault: empty position")

    await dai.mint(user0.address, expandDecimals(1000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(100, 18))
    await vault.buyUSDG(dai.address, user1.address)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(40000))

    await dai.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

    let position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount
    expect(position[5]).eq(0) // pnl
    expect(position[6]).eq(true) // hasRealisedProfit

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(44000))
    let delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq(toUsd(9))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq(toUsd(9))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(89.99775))

    let leverage = await vault.getPositionLeverage(user0.address, dai.address, btc.address, false)
    expect(leverage).eq(90817) // ~9X leverage

    await expect(vault.connect(user0).decreasePosition(user0.address, dai.address, btc.address, 0, toUsd(100), false, user2.address))
      .to.be.revertedWith("Vault: position size exceeded")

    await expect(vault.connect(user0).decreasePosition(user0.address, dai.address, btc.address, toUsd(10), toUsd(50), false, user2.address))
      .to.be.revertedWith("SafeMath: subtraction overflow")

    await expect(vault.connect(user0).decreasePosition(user0.address, dai.address, btc.address, toUsd(5), toUsd(50), false, user2.address))
      .to.be.revertedWith("Vault: liquidation fees exceed collateral")

    expect(await vault.feeReserves(dai.address)).eq("390000000000000000") // 0.39
    expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
    expect(await vault.guaranteedUsd(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq("99700000000000000000")
    expect(await dai.balanceOf(user2.address)).eq(0)

    const tx = await vault.connect(user0).decreasePosition(user0.address, dai.address, btc.address, toUsd(3), toUsd(50), false, user2.address)
    await reportGasUsed(provider, tx, "decreasePosition gas used")

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(40)) // size
    expect(position[1]).eq(toUsd(9.91 - 3)) // collateral
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(40, 18)) // reserveAmount
    expect(position[5]).eq(toUsd(49.99875)) // pnl
    expect(position[6]).eq(true) // hasRealisedProfit

    expect(await vault.feeReserves(dai.address)).eq("440000000000000000") // 0.44
    expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(40, 18))
    expect(await vault.guaranteedUsd(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq("46701250000000000000") // 46.70125
    expect(await dai.balanceOf(user2.address)).eq("52948750000000000000") // 52.94875

    leverage = await vault.getPositionLeverage(user0.address, dai.address, btc.address, false)
    expect(leverage).eq(57887) // ~5.8X leverage
  })

  it("liquidate short", async () => {
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
    await expect(vault.connect(user0).liquidatePosition(user0.address, dai.address, bnb.address, false, user2.address))
      .to.be.revertedWith("Vault: _collateralToken not whitelisted")
    await expect(vault.connect(user0).liquidatePosition(user0.address, bnb.address, dai.address, false, user2.address))
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
    await expect(vault.connect(user0).liquidatePosition(user0.address, dai.address, dai.address, false, user2.address))
      .to.be.revertedWith("Vault: _indexToken must not be a stableToken")

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

    await expect(vault.connect(user0).liquidatePosition(user0.address, dai.address, btc.address, false, user2.address))
      .to.be.revertedWith("Vault: empty position")

    await dai.mint(user0.address, expandDecimals(1000, 18))
    await dai.connect(user0).transfer(vault.address, expandDecimals(100, 18))
    await vault.buyUSDG(dai.address, user1.address)

    await dai.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await vault.connect(user0).increasePosition(user0.address, dai.address, btc.address, toUsd(90), false)

    let position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount

    expect((await vault.validateLiquidation(user0.address, dai.address, btc.address, false, false))[0]).eq(false)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(39000))

    let delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(true)
    expect(delta[1]).eq(toUsd(2.25)) // 1000 / 40,000 * 90
    expect((await vault.validateLiquidation(user0.address, dai.address, btc.address, false, false))[0]).eq(false)

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(41000))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq(toUsd(2.25))
    expect((await vault.validateLiquidation(user0.address, dai.address, btc.address, false, false))[0]).eq(false)

    await expect(vault.liquidatePosition(user0.address, dai.address, btc.address, false, user2.address))
      .to.be.revertedWith("Vault: position cannot be liquidated")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(42500))
    delta = await vault.getPositionDelta(user0.address, dai.address, btc.address, false)
    expect(delta[0]).eq(false)
    expect(delta[1]).eq("5625000000000000000000000000000") // 2500 / 40,000 * 90 => 5.625
    expect((await vault.validateLiquidation(user0.address, dai.address, btc.address, false, false))[0]).eq(true)

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(toUsd(90)) // size
    expect(position[1]).eq(toUsd(9.91)) // collateral, 10 - 90 * 0.1%
    expect(position[2]).eq(toNormalizedPrice(40000)) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(expandDecimals(90, 18)) // reserveAmount

    expect(await vault.feeReserves(dai.address)).eq("390000000000000000") // 0.39
    expect(await vault.reservedAmounts(dai.address)).eq(expandDecimals(90, 18))
    expect(await vault.guaranteedUsd(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq("99700000000000000000")
    expect(await dai.balanceOf(user2.address)).eq(0)

    const tx = await vault.liquidatePosition(user0.address, dai.address, btc.address, false, user2.address)
    await reportGasUsed(provider, tx, "liquidatePosition gas used")

    position = await vault.getPosition(user0.address, dai.address, btc.address, false)
    expect(position[0]).eq(0) // size
    expect(position[1]).eq(0) // collateral
    expect(position[2]).eq(0) // averagePrice
    expect(position[3]).eq(0) // entryFundingRate
    expect(position[4]).eq(0) // reserveAmount

    expect(await vault.feeReserves(dai.address)).eq("480000000000000000") // 0.48
    expect(await vault.reservedAmounts(dai.address)).eq(0)
    expect(await vault.guaranteedUsd(dai.address)).eq(0)
    expect(await vault.poolAmounts(dai.address)).eq("104520000000000000000") // 104.52
    expect(await dai.balanceOf(user2.address)).eq(expandDecimals(5, 18))
  })
})
