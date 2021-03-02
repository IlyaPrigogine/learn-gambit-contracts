const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")

use(solidity)

describe("BatchSender", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let batchSender
  let token

  beforeEach(async () => {
    batchSender = await deployContract("BatchSender", [])
    token = await deployContract("Token", [])
  })

  it("send", async () => {
      expect(await token.balanceOf(wallet.address)).eq(0)
      await token.mint(wallet.address, 1500)
      expect(await token.balanceOf(wallet.address)).eq(1500)

      expect(await token.balanceOf(user0.address)).eq(0)
      expect(await token.balanceOf(user1.address)).eq(0)
      expect(await token.balanceOf(user2.address)).eq(0)
      expect(await token.balanceOf(user3.address)).eq(0)

      const accounts = [user0.address, user1.address, user2.address, user3.address]
      const amounts = [100, 200, 300, 400]

      await token.approve(batchSender.address, 1000)
      await batchSender.send(token.address, accounts, amounts)

      expect(await token.balanceOf(user0.address)).eq(100)
      expect(await token.balanceOf(user1.address)).eq(200)
      expect(await token.balanceOf(user2.address)).eq(300)
      expect(await token.balanceOf(user3.address)).eq(400)
      expect(await token.balanceOf(wallet.address)).eq(500)
  })
})
