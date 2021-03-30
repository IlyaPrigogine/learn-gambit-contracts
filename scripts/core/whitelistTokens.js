const { deployContract, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const vault = { address: "<TODO FILL IN ADDRESS>" }

  const btc = { address: "<TODO FILL IN ADDRESS>" }
  const eth = { address: "<TODO FILL IN ADDRESS>" }
  const bnb = { address: "<TODO FILL IN ADDRESS>" }
  const link = { address: "<TODO FILL IN ADDRESS>" }
  const busd = { address: "<TODO FILL IN ADDRESS>" }

  await sendTxn(vault.setTokenConfig(
    btc.address, // _token
    "<TODO FILL IN ADDRESS>", // _priceFeed
    "<TODO FILL IN DECIMALS", // _priceDecimals
    8, // _tokenDecimals
    10000, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(btc)")

  await sendTxn(vault.setTokenConfig(
    eth.address, // _token
    "<TODO FILL IN ADDRESS>", // _priceFeed
    "<TODO FILL IN DECIMALS", // _priceDecimals
    18, // _tokenDecimals
    10000, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(eth)")

  await sendTxn(vault.setTokenConfig(
    bnb.address, // _token
    "<TODO FILL IN ADDRESS>", // _priceFeed
    "<TODO FILL IN DECIMALS", // _priceDecimals
    18, // _tokenDecimals
    10000, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    link.address, // _token
    "<TODO FILL IN ADDRESS>", // _priceFeed
    "<TODO FILL IN DECIMALS", // _priceDecimals
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    busd.address, // _token
    "<TODO FILL IN ADDRESS>", // _priceFeed
    "<TODO FILL IN DECIMALS", // _priceDecimals
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    true // _isStable
  ), "vault.setTokenConfig(busd)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
