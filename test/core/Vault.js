const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")

use(solidity)

describe("Vault", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let bnb
  let bnbPriceFeed

  beforeEach(async () => {
    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    await vault.initialize(usdg.address, 5)

    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])
  })

  it("inits", async () => {
    expect(await usdg.gov()).eq(wallet.address)
    expect(await usdg.vault()).eq(vault.address)

    expect(await vault.gov()).eq(wallet.address)
    expect(await vault.usdg()).eq(usdg.address)
    expect(await vault.liquidationFeeUsd()).eq(5)
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
})
