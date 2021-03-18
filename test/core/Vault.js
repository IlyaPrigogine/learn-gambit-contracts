const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")

use(solidity)

describe("Vault", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let vault
  let usdg
  let wbnb
  let wbnbPriceFeed

  beforeEach(async () => {
    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    await vault.initialize(usdg.address, 5)

    wbnb = await deployContract("Token", [])
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
})
