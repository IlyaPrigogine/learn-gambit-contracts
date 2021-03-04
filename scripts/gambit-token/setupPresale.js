const { contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const wallet = { address: "0x9f169c2189A2d975C18965DE985936361b4a9De9" }
  const gmt = await contractAt("GMT", "0xC2A6F2aFb618FC5e255A83943dD79faDC00bDCD4")
  const treasury = await contractAt("Treasury", "0xa00B112CE49d9d04631629Df5f87017255C2381D")

  const hasActiveMigration = await gmt.hasActiveMigration()
  if (!hasActiveMigration) {
    throw new Error("GMT migration not started")
  }

  await sendTxn(gmt.addAdmin(treasury.address), "gmt.addAdmin(treasury)")
  await sendTxn(gmt.addMsgSender(treasury.address), "gmt.addMsgSender(treasury)")
  await sendTxn(gmt.addMsgSender(wallet.address), "gmt.addMsgSender(wallet)")

  await sendTxn(gmt.transfer(treasury.address, expandDecimals(1000, 18)), "gmt.transfer")

  // TODO: update whitelist
  const whitelist = [wallet.address]
  await sendTxn(treasury.addWhitelists(whitelist), "treasury.addWhitelists")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
