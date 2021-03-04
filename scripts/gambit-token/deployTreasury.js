const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const PRECISION = 1000000

async function main() {
  const treasury = await contractAt("Treasury", "0xa00B112CE49d9d04631629Df5f87017255C2381D")
  const gmt = await contractAt("GMT", "0xC2A6F2aFb618FC5e255A83943dD79faDC00bDCD4")
  const busd = await contractAt("Token", "0xe9e7cea3dedca5984780bafc599bd69add087d56")
  const router = { address: "0x05ff2b0db69458a0750badebc4f9e13add608c7f" }
  const fund = { address: "0x58CAaCa45a213e9218C5fFd605d5B953da9b9a91" }
  const gmtPresalePrice = 4.5 * PRECISION
  const gmtListingPrice = 5 * PRECISION
  const busdSlotCap = expandDecimals(2000, 18)
  const busdHardCap = expandDecimals(900 * 1000, 18)
  const busdBasisPoints = 5000 // 50%
  const unlockTime = 1615291200 // Tuesday, 9 March 2021 12:00:00 (GMT+0)

  await sendTxn(treasury.initialize(
    [
      gmt.address,
      busd.address,
      router.address,
      fund.address
    ],
    [
      gmtPresalePrice,
      gmtListingPrice,
      busdSlotCap,
      busdHardCap,
      busdBasisPoints,
      unlockTime
    ]
  ), "treasury.initialize")

  return { treasury }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
