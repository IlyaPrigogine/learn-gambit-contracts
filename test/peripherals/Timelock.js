const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault } = require("../core/Vault/helpers")

use(solidity)

describe("Timelock", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let vaultPriceFeed
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
  let timelock

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
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])

    await initVault(vault, router, usdg, vaultPriceFeed)

    distributor0 = await deployContract("TimeDistributor", [])
    yieldTracker0 = await deployContract("YieldTracker", [usdg.address])

    await yieldTracker0.setDistributor(distributor0.address)
    await distributor0.setDistribution([yieldTracker0.address], [1000], [bnb.address])

    await bnb.mint(distributor0.address, 5000)
    await usdg.setYieldTrackers([yieldTracker0.address])

    await vault.setPriceFeed(user3.address)

    timelock = await deployContract("Timelock", [5 * 24 * 60 * 60])
    await vault.setGov(timelock.address)

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await vaultPriceFeed.setGov(timelock.address)
    await router.setGov(timelock.address)
  })

  it("inits", async () => {
    expect(await usdg.gov()).eq(wallet.address)
    expect(await usdg.vaults(vault.address)).eq(true)
    expect(await usdg.vaults(user0.address)).eq(false)

    expect(await vault.gov()).eq(timelock.address)
    expect(await vault.isInitialized()).eq(true)
    expect(await vault.router()).eq(router.address)
    expect(await vault.usdg()).eq(usdg.address)
    expect(await vault.maxUsdgBatchSize()).eq(expandDecimals(600 * 1000, 18))
    expect(await vault.maxUsdgBuffer()).eq(expandDecimals(100 * 1000, 18))
    expect(await vault.liquidationFeeUsd()).eq(toUsd(5))
    expect(await vault.fundingRateFactor()).eq(600)

    expect(await vault.isMintingEnabled()).eq(false)
  })

  it("setIsAmmEnabled", async () => {
    await expect(timelock.connect(user0).setIsAmmEnabled(vaultPriceFeed.address, false))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vaultPriceFeed.isAmmEnabled()).eq(true)
    await timelock.connect(wallet).setIsAmmEnabled(vaultPriceFeed.address, false)
    expect(await vaultPriceFeed.isAmmEnabled()).eq(false)
  })

  it("setMaxStrictPriceDeviation", async () => {
    await expect(timelock.connect(user0).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(0)
    await timelock.connect(wallet).setMaxStrictPriceDeviation(vaultPriceFeed.address, 100)
    expect(await vaultPriceFeed.maxStrictPriceDeviation()).eq(100)
  })

  it("setPriceSampleSpace", async () => {
    await expect(timelock.connect(user0).setPriceSampleSpace(vaultPriceFeed.address, 0))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vaultPriceFeed.priceSampleSpace()).eq(3)
    await timelock.connect(wallet).setPriceSampleSpace(vaultPriceFeed.address, 1)
    expect(await vaultPriceFeed.priceSampleSpace()).eq(1)
  })

  it("setIsMintingEnabled", async () => {
    await expect(timelock.connect(user0).setIsMintingEnabled(vault.address, true))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.isMintingEnabled()).eq(false)
    await timelock.connect(wallet).setIsMintingEnabled(vault.address, true)
    expect(await vault.isMintingEnabled()).eq(true)
  })

  it("setIsSwapEnabled", async () => {
    await expect(timelock.connect(user0).setIsSwapEnabled(vault.address, false))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.isSwapEnabled()).eq(true)
    await timelock.connect(wallet).setIsSwapEnabled(vault.address, false)
    expect(await vault.isSwapEnabled()).eq(false)
  })

  it("setMaxUsdg", async () => {
    await expect(timelock.connect(user0).setMaxUsdg(vault.address, 500, 1000))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.maxUsdgBatchSize()).eq(expandDecimals(600 * 1000, 18))
    expect(await vault.maxUsdgBuffer()).eq(expandDecimals(100 * 1000, 18))
    await timelock.connect(wallet).setMaxUsdg(vault.address, 500, 1000)
    expect(await vault.maxUsdgBatchSize()).eq(500)
    expect(await vault.maxUsdgBuffer()).eq(1000)
  })

  it("setMaxGasPrice", async () => {
    await expect(timelock.connect(user0).setMaxGasPrice(vault.address, 7000000000))
      .to.be.revertedWith("Timelock: forbidden")

    expect(await vault.maxGasPrice()).eq(10000000000)
    await timelock.connect(wallet).setMaxGasPrice(vault.address, 7000000000)
    expect(await vault.maxGasPrice()).eq(7000000000)
  })

  it("approve", async () => {
    await expect(timelock.connect(user0).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalApprove(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).approve(bnb.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(101, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await dai.mint(timelock.address, expandDecimals(150, 18))

    expect(await dai.balanceOf(timelock.address)).eq(expandDecimals(150, 18))
    expect(await dai.balanceOf(user1.address)).eq(0)

    await expect(dai.connect(user1).transferFrom(timelock.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18))
    await expect(dai.connect(user2).transferFrom(timelock.address, user2.address, expandDecimals(100, 18)))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")
    await dai.connect(user1).transferFrom(timelock.address, user1.address, expandDecimals(100, 18))

    expect(await dai.balanceOf(timelock.address)).eq(expandDecimals(50, 18))
    expect(await dai.balanceOf(user1.address)).eq(expandDecimals(100, 18))

    await expect(dai.connect(user1).transferFrom(timelock.address, user1.address, expandDecimals(1, 18)))
      .to.be.revertedWith("ERC20: transfer amount exceeds allowance")

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")

    await timelock.connect(wallet).signalApprove(dai.address, user1.address, expandDecimals(100, 18))

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["approve", bnb.address, user1.address, expandDecimals(100, 18)])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address", "uint256"], ["approve", dai.address, user1.address, expandDecimals(100, 18)])

    await expect(timelock.connect(user0).cancelAction(action0))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).approve(dai.address, user1.address, expandDecimals(100, 18)))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("setGov", async () => {
    await expect(timelock.connect(user0).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalSetGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalSetGov(vault.address, user1.address)

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setGov(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setGov(user2.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await vault.gov()).eq(timelock.address)
    await timelock.connect(wallet).setGov(vault.address, user1.address)
    expect(await vault.gov()).eq(user1.address)

    await timelock.connect(wallet).signalSetGov(vault.address, user2.address)

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setGov", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setGov", vault.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setGov(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("setPriceFeed", async () => {
    await expect(timelock.connect(user0).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalSetPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, user1.address)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).setPriceFeed(user2.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await vault.priceFeed()).eq(user3.address)
    await timelock.connect(wallet).setPriceFeed(vault.address, user1.address)
    expect(await vault.priceFeed()).eq(user1.address)

    await timelock.connect(wallet).signalSetPriceFeed(vault.address, user2.address)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setPriceFeed", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["setPriceFeed", vault.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).setPriceFeed(vault.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")
  })

  it("addPlugin", async () => {
    await expect(timelock.connect(user0).addPlugin(router.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await expect(timelock.connect(wallet).addPlugin(router.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(user0).signalAddPlugin(router.address, user1.address))
      .to.be.revertedWith("Timelock: forbidden")

    await timelock.connect(wallet).signalAddPlugin(router.address, user1.address)

    await expect(timelock.connect(wallet).addPlugin(router.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 4 * 24 * 60 * 60)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).addPlugin(router.address, user1.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    await increaseTime(provider, 1 * 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(timelock.connect(wallet).addPlugin(user2.address, user1.address))
      .to.be.revertedWith("Timelock: action not signalled")

    await expect(timelock.connect(wallet).addPlugin(router.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")

    expect(await router.plugins(user1.address)).eq(false)
    await timelock.connect(wallet).addPlugin(router.address, user1.address)
    expect(await router.plugins(user1.address)).eq(true)

    await timelock.connect(wallet).signalAddPlugin(router.address, user2.address)

    await expect(timelock.connect(wallet).addPlugin(router.address, user2.address))
      .to.be.revertedWith("Timelock: action time not yet passed")

    const action0 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["addPlugin", user1.address, user2.address])
    const action1 = ethers.utils.solidityKeccak256(["string", "address", "address"], ["addPlugin", router.address, user2.address])

    await expect(timelock.connect(wallet).cancelAction(action0))
      .to.be.revertedWith("Timelock: invalid _action")

    await timelock.connect(wallet).cancelAction(action1)

    await expect(timelock.connect(wallet).addPlugin(router.address, user2.address))
      .to.be.revertedWith("Timelock: action not signalled")
  })
})
