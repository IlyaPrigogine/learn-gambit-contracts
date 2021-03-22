const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")

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

  beforeEach(async () => {
    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    await vault.initialize(usdg.address, 5)

    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])
  })

  it("inits", async () => {
    expect(await usdg.gov()).eq(wallet.address)
    expect(await usdg.vault()).eq(vault.address)

    expect(await vault.gov()).eq(wallet.address)
    expect(await vault.usdg()).eq(usdg.address)
    expect(await vault.liquidationFeeUsd()).eq("5000000000000000000")
    expect(await vault.tokenDecimals(usdg.address)).eq(18)
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

  it("extendGovUnlockTime", async () => {
    await expect(vault.connect(user0).extendGovUnlockTime(100))
      .to.be.revertedWith("Vault: forbidden")

    expect(await vault.govUnlockTime()).eq(0)

    await vault.extendGovUnlockTime(100)
    expect(await vault.govUnlockTime()).eq(100)

    await expect(vault.extendGovUnlockTime(99))
      .to.be.revertedWith("Vault: invalid _govUnlockTime")

    await vault.extendGovUnlockTime(101)
    expect(await vault.govUnlockTime()).eq(101)
  })

  it("addWhitelistedToken", async () => {
    const params = [
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
      false // _isStable
    ]

    await expect(vault.connect(user0).addWhitelistedToken(...params))
      .to.be.revertedWith("Vault: forbidden")

    const blockTime = await getBlockTime(provider)
    await vault.extendGovUnlockTime(blockTime + 1000)

    await expect(vault.addWhitelistedToken(...params))
      .to.be.revertedWith("Vault: govUnlockTime has not yet passed")

    await increaseTime(provider, 1100)
    await mineBlock(provider)

    await expect(vault.addWhitelistedToken(...params))
      .to.be.revertedWith("Vault: could not fetch price")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await vault.addWhitelistedToken(...params)

    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.priceFeeds(bnb.address)).eq(bnbPriceFeed.address)
    expect(await vault.priceDecimals(bnb.address)).eq(8)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(9000)
    expect(await vault.tokenDecimals(bnb.address)).eq(18)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await expect(vault.addWhitelistedToken(...params))
      .to.be.revertedWith("Vault: token already whitelisted")
  })

  it("removeWhitelistedToken", async () => {
    const params = [
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
      false // _isStable
    ]

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await vault.addWhitelistedToken(...params)

    expect(await vault.whitelistedTokens(bnb.address)).eq(true)
    expect(await vault.priceFeeds(bnb.address)).eq(bnbPriceFeed.address)
    expect(await vault.priceDecimals(bnb.address)).eq(8)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(9000)
    expect(await vault.tokenDecimals(bnb.address)).eq(18)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await expect(vault.connect(user0).removeWhitelistedToken(bnb.address))
      .to.be.revertedWith("Vault: forbidden")

    const blockTime = await getBlockTime(provider)
    await vault.extendGovUnlockTime(blockTime + 1000)

    await expect(vault.removeWhitelistedToken(bnb.address))
      .to.be.revertedWith("Vault: govUnlockTime has not yet passed")

    await increaseTime(provider, 1100)
    await mineBlock(provider)

    await vault.removeWhitelistedToken(bnb.address)

    expect(await vault.whitelistedTokens(bnb.address)).eq(false)
    expect(await vault.priceFeeds(bnb.address)).eq(ethers.constants.AddressZero)
    expect(await vault.priceDecimals(bnb.address)).eq(0)
    expect(await vault.redemptionBasisPoints(bnb.address)).eq(0)
    expect(await vault.tokenDecimals(bnb.address)).eq(0)
    expect(await vault.stableTokens(bnb.address)).eq(false)

    await expect(vault.removeWhitelistedToken(bnb.address))
      .to.be.revertedWith("Vault: token not whitelisted")
  })

  it("buyUSDG", async () => {
    await expect(vault.connect(user0).buyUSDG(bnb.address, user1.address))
      .to.be.revertedWith("Vault: _token not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.addWhitelistedToken(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
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

    await vault.addWhitelistedToken(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
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
    await vault.addWhitelistedToken(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
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
    await vault.addWhitelistedToken(
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      8, // _tokenDecimals
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
    await vault.addWhitelistedToken(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
      false // _isStable
    )

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.addWhitelistedToken(
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      8, // _tokenDecimals
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
      .to.be.revertedWith("Vault: invalid totalUsdgAmount")

    await vault.connect(user0).sellUSDG(bnb.address, user1.address)
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
    await vault.addWhitelistedToken(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
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
    await vault.addWhitelistedToken(
      bnb.address, // _token
      bnbPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      18, // _tokenDecimals
      false // _isStable
    )

    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenOut not whitelisted")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.addWhitelistedToken(
      btc.address, // _token
      btcPriceFeed.address, // _priceFeed
      8, // _priceDecimals
      9000, // _redemptionBps
      8, // _tokenDecimals
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
      .to.be.revertedWith("Vault: invalid totalUsdgAmount")
  })
})
