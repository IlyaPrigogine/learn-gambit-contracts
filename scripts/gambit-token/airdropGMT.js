const { contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const gmt = await contractAt("GMT", "0xC2A6F2aFb618FC5e255A83943dD79faDC00bDCD4")
  const batchSender = await contractAt("BatchSender", "0x04c5B7575De2E00079e11578bF00F09C07007Bda")

  await sendTxn(gmt.beginMigration(), "gmt.beginMigration")
  await sendTxn(gmt.addMsgSender(batchSender.address), "gmt.addMsgSender(batchSender)")

  // TODO: airdrop tokens with updated addresses
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
