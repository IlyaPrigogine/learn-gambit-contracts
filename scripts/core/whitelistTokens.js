const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const vault = await contractAt("Vault", "0x4981AC7882Dd4Ec4759e00fE88a5C95e5e5b0d1d")
  const ammPriceFeed = { address: "0xBDC8da33c704964a5F592a52aF26eda040361758" }
  const redemptionBasisPoints = 10000

  const btc = { address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c" }
  const eth = { address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8" }
  const bnb = { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }
  const busd = { address: "0xe9e7cea3dedca5984780bafc599bd69add087d56" }
  const usdc = { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" }
  const usdt = { address: "0x55d398326f99059fF775485246999027B3197955" }

  await sendTxn(vault.setTokenConfig(
    btc.address, // _token
    "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    false, // _isStrictStable
    true // _isShortable
  ), "vault.setTokenConfig(btc)")

  await sendTxn(vault.setTokenConfig(
    eth.address, // _token
    "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    false, // _isStrictStable
    true // _isShortable
  ), "vault.setTokenConfig(eth)")

  await sendTxn(vault.setTokenConfig(
    bnb.address, // _token
    "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    false, // _isStrictStable
    true // _isShortable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    busd.address, // _token
    "0xcBb98864Ef56E9042e7d2efef76141f15731B82f", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    true, // _isStable
    true, // _isStrictStable
    false // _isShortable
  ), "vault.setTokenConfig(busd)")

  await sendTxn(vault.setTokenConfig(
    usdc.address, // _token
    "0x51597f405303C4377E36123cBc172b13269EA163", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    true, // _isStable
    true, // _isStrictStable
    false // _isShortable
  ), "vault.setTokenConfig(usdc)")

  await sendTxn(vault.setTokenConfig(
    usdt.address, // _token
    "0xB97Ad0E74fa7d920791E90258A6E2085088b4320", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    true, // _isStable
    true, // _isStrictStable
    false // _isShortable
  ), "vault.setTokenConfig(usdt)")

  await sendTxn(vault.setAmmPriceFeed(ammPriceFeed.address), "vault.setAmmPriceFeed")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
