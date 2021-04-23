const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig } = require("../core/Vault/helpers")

use(solidity)

describe("AmmPriceFeed", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let router
  let bnb
  let bnbPriceFeed
  let eth
  let ethPriceFeed
  let btc
  let btcPriceFeed
  let busd
  let busdPriceFeed

  let pancakeFactory
  let ammPriceFeed

  let bnbBusdPair
  let btcBnbPair

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address])

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await busdPriceFeed.setLatestAnswer(toChainlinkPrice(1))

    await initVault(vault, router, usdg)
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

    bnbBusdPair = newWallet()
    btcBnbPair = newWallet()

    await bnb.mint(bnbBusdPair.address, expandDecimals(1 * 1000, 18))
    await busd.mint(bnbBusdPair.address, expandDecimals(300 * 1000, 18))

    await btc.mint(btcBnbPair.address, expandDecimals(10, 8))
    await bnb.mint(btcBnbPair.address, expandDecimals(2000, 18))

    pancakeFactory = await deployContract("PancakeFactory", [[
        btc.address,
        bnb.address,
        busd.address,
        bnbBusdPair.address,
        btcBnbPair.address
    ]])

    ammPriceFeed = await deployContract("AmmPriceFeed", [])
    await ammPriceFeed.initialize([
        vault.address,
        pancakeFactory.address,
        btc.address,
        eth.address,
        bnb.address,
        busd.address
    ])
  })

  it("inits", async () => {
    expect(await ammPriceFeed.isInitialized()).eq(true)
    expect(await ammPriceFeed.vault()).eq(vault.address)
    expect(await ammPriceFeed.factory()).eq(pancakeFactory.address)
    expect(await ammPriceFeed.btc()).eq(btc.address)
    expect(await ammPriceFeed.eth()).eq(eth.address)
    expect(await ammPriceFeed.bnb()).eq(bnb.address)
    expect(await ammPriceFeed.busd()).eq(busd.address)

    await expect(ammPriceFeed.connect(wallet).initialize([]))
      .to.be.revertedWith("AmmPriceFeed: already initialized")
  })

  it("setFactory", async () => {
    await expect(ammPriceFeed.connect(user0).setFactory(user1.address))
      .to.be.revertedWith("AmmPriceFeed: forbidden")

    expect(await ammPriceFeed.factory()).eq(pancakeFactory.address)
    await ammPriceFeed.setFactory(user1.address)
    expect(await ammPriceFeed.factory()).eq(user1.address)
  })

  it("getPrice for bnb", async () => {
      expect(await ammPriceFeed.getPrice(bnb.address)).eq(toNormalizedPrice(300))
  })

  it("getPrice for btc", async () => {
      expect(await ammPriceFeed.getPrice(btc.address)).eq(toNormalizedPrice(60000))
  })
})
