const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")

async function main() {
  const nativeToken = { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }
  const vault = await deployContract("Vault", [])
  const usdg = await deployContract("USDG", [vault.address])
  const router = await deployContract("Router", [vault.address, usdg.address, nativeToken.address])
  const ammFactory = { address: "0xbcfccbde45ce874adcb698cc183debcf17952812" }

  const btc = { address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c" }
  const eth = { address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8" }
  const bnb = nativeToken
  const busd = { address: "0xe9e7cea3dedca5984780bafc599bd69add087d56" }

  const ammPriceFeed = await deployContract("AmmPriceFeed", [])

  await sendTxn(ammPriceFeed.initialize([
    vault.address,
    ammFactory.address,
    btc.address,
    eth.address,
    bnb.address,
    busd.address
  ]), "ammPriceFeed.initialize")

  await sendTxn(vault.initialize(
    router.address, // router
    usdg.address, // usdg
    expandDecimals(60, 18), // maxUsdgBatchSize
    expandDecimals(5, 18), // maxUsdgBuffer
    toUsd(5), //  liquidationFeeUsd
    600, // fundingRateFactor
    5000000000, // maxGasPrice, 5 gwei
    20000 // maxDebtBasisPoints
  ), "vault.initialize")

  await sendTxn(vault.setMaxStrictPriceDeviation(expandDecimals(2, 28)), "vault.setMaxStrictPriceDeviation") // 0.02 USD

  await sendTxn(vault.setFees(
    20, // swapFeeBasisPoints
    10, // stableSwapFeeBasisPoints
    10, // marginFeeBasisPoints
    toUsd(5) // liquidationFeeUsd
  ), "vault.setFees")

  await sendTxn(vault.setPriceSampleSpace(2), "vault.setPriceSampleSpace")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
