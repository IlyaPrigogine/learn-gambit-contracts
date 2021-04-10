const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  // TODO: update BTC decimals
  const vault = await contractAt("Vault", "0x96EE5959d640Bf6F7BdEcAf55E65Cb8b5fD09856")
  const busdPriceFeed = { address: "0x532Ea3DffE5a4376Db88AC69484D5d62F277cf98" }

  const redemptionBasisPoints = 10000 * 2

  const btc = { address: "0x341F41c455fB3E08A1078D1a9c4dAd778c41E7C4" }
  const eth = { address: "0x6E9eef21FE69894f088bf6d27Dc36aa74898BA8c" }
  const bnb = { address: "0x6A2345E019DB2aCC6007DCD3A69731F51D7Dca52" }
  const busd = { address: "0xae7486c680720159130b71e0f9EF7AFd8f413227" }

  await sendTxn(vault.setTokenConfig(
    btc.address, // _token
    "0x5741306c21795FdCBb9b265Ea0255F499DFe515C", // _priceFeed
    8, // _priceDecimals
    8, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(btc)")

  await sendTxn(vault.setTokenConfig(
    eth.address, // _token
    "0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(eth)")

  await sendTxn(vault.setTokenConfig(
    bnb.address, // _token
    "0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    125, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    busd.address, // _token
    busdPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    125, // _minProfitBps
    true // _isStable
  ), "vault.setTokenConfig(busd)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
