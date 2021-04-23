const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../../shared/utilities")
const { toChainlinkPrice } = require("../../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getEthConfig, getDaiConfig } = require("./helpers")

use(solidity)

describe("Vault.swap", function () {
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

  it("swap", async () => {
    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address, { gasPrice: "11000000000" } ))
      .to.be.revertedWith("Vault: maxGasPrice exceeded")

    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenIn not whitelisted")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await expect(vault.connect(user1).swap(bnb.address, btc.address, user2.address))
      .to.be.revertedWith("Vault: _tokenOut not whitelisted")

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

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

    await bnb.mint(user1.address, expandDecimals(100, 18))
    await bnb.connect(user1).transfer(vault.address, expandDecimals(100, 18))

    expect(await btc.balanceOf(user1.address)).eq(0)
    expect(await btc.balanceOf(user2.address)).eq(0)
    const tx = await vault.connect(user1).swap(bnb.address, btc.address, user2.address)
    await reportGasUsed(provider, tx, "swap gas used")

    expect(await btc.balanceOf(user1.address)).eq(0)
    expect(await btc.balanceOf(user2.address)).eq(expandDecimals(4, 7).sub("120000")) // 0.8 - 0.0012

    expect(await vault.feeReserves(bnb.address)).eq("600000000000000000") // 200 * 0.3% => 0.6
    expect(await vault.usdgAmounts(bnb.address)).eq(expandDecimals(100 * 400, 18).add(expandDecimals(200 * 300, 18)).sub(expandDecimals(180, 18)))
    expect(await vault.poolAmounts(bnb.address)).eq(expandDecimals(100, 18).add(expandDecimals(200, 18)).sub("600000000000000000"))

    expect(await vault.feeReserves(btc.address)).eq("420000") // 1 * 0.3% => 0.003, 0.4 * 0.3% => 0.0012
    expect(await vault.usdgAmounts(btc.address)).eq(expandDecimals(200 * 300, 18).sub(expandDecimals(180, 18)).sub(expandDecimals(100 * 400, 18)))
    expect(await vault.poolAmounts(btc.address)).eq(expandDecimals(1, 8).sub("300000").sub(expandDecimals(4, 7))) // 59700000, 0.597 BTC, 0.597 * 100,000 => 59700

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(400))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(500))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(450))

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq(0)
    await usdg.connect(user0).transfer(vault.address, expandDecimals(50000, 18))
    await vault.sellUSDG(bnb.address, user3.address)
    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user3.address)).eq("99700000000000000000") // 99.7, 50000 / 500 * 99.7%

    await usdg.connect(user0).transfer(vault.address, expandDecimals(50000, 18))
    await vault.sellUSDG(btc.address, user3.address)

    await usdg.connect(user0).transfer(vault.address, expandDecimals(10000, 18))
    await expect(vault.sellUSDG(btc.address, user3.address))
      .to.be.revertedWith("Vault: poolAmount exceeded")
  })

  it("caps max USDG amount", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000))
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed))

    await bnb.mint(user0.address, expandDecimals(499, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(499, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await eth.mint(user0.address, expandDecimals(10, 18))
    await eth.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await vault.connect(user0).buyUSDG(eth.address, user1.address)

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await vault.connect(user0).swap(bnb.address, eth.address, user1.address)

    await bnb.mint(user0.address, expandDecimals(2, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(2, 18))
    await expect(vault.connect(user0).swap(bnb.address, eth.address, user1.address))
      .to.be.revertedWith("Vault: max USDG exceeded")
  })

  it("caps max USDG debt", async () => {
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(600))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await ethPriceFeed.setLatestAnswer(toChainlinkPrice(3000))
    await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed))

    await bnb.mint(user0.address, expandDecimals(100, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(100, 18))
    await vault.connect(user0).buyUSDG(bnb.address, user0.address)

    await eth.mint(user0.address, expandDecimals(10, 18))

    expect(await eth.balanceOf(user0.address)).eq(expandDecimals(10, 18))
    expect(await bnb.balanceOf(user1.address)).eq(0)

    await eth.connect(user0).transfer(vault.address, expandDecimals(10, 18))
    await vault.connect(user0).swap(eth.address, bnb.address, user1.address)

    expect(await eth.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(user1.address)).eq("49850000000000000000")

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))

    await eth.mint(user0.address, expandDecimals(1, 18))
    await eth.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await expect(vault.connect(user0).swap(eth.address, bnb.address, user1.address))
      .to.be.revertedWith("Vault: max debt exceeded")

    await bnb.mint(user0.address, expandDecimals(1, 18))
    await bnb.connect(user0).transfer(vault.address, expandDecimals(1, 18))
    await vault.connect(user0).swap(bnb.address, eth.address, user1.address)
  })
})
