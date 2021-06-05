const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const shouldSetTokenConfig = false

async function setVaultTokenConfig({
  vault,
  token,
  tokenDecimals,
  redemptionBasisPoints,
  minProfitBps,
  isStable,
  isShortable,
  symbol
}) {
  if (!shouldSetTokenConfig) { return }

  await sendTxn(vault.setTokenConfig(
    token.address, // _token
    tokenDecimals, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    minProfitBps, // _minProfitBps
    isStable, // _isStable
    isShortable // _isShortable
  ), `vault.setTokenConfig(${symbol})`)
}

async function main() {
  const vault = await contractAt("Vault", "0xc73A8DcAc88498FD4b4B1b2AaA37b0a2614Ff67B")
  const secondaryPriceFeed = { address: "0xDA7a001b254CD22e46d3eAB04d937489c93174C3" }
  const vaultPriceFeed = await contractAt("VaultPriceFeed", "0x52F6D18B259B8e4864957F52Fd16eC97402d83B9")
  const redemptionBasisPoints = 10000

  const btc = { address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c" }
  const eth = { address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8" }
  const bnb = { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" }
  const busd = { address: "0xe9e7cea3dedca5984780bafc599bd69add087d56" }
  const usdc = { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" }
  const usdt = { address: "0x55d398326f99059fF775485246999027B3197955" }

  const btcPriceFeed = { address: "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf" }
  const ethPriceFeed = { address: "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e" }
  const bnbPriceFeed = { address: "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE" }
  const busdPriceFeed = { address: "0xcBb98864Ef56E9042e7d2efef76141f15731B82f" }
  const usdcPriceFeed = { address: "0x51597f405303C4377E36123cBc172b13269EA163" }
  const usdtPriceFeed = { address: "0xB97Ad0E74fa7d920791E90258A6E2085088b4320" }

  await sendTxn(vaultPriceFeed.setSecondaryPriceFeed(secondaryPriceFeed.address), "vaultPriceFeed.setSecondaryPriceFeed")

  await sendTxn(vaultPriceFeed.setTokenConfig(
    btc.address, // _token
    btcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(btc)")

  await setVaultTokenConfig({
    vault,
    token: btc,
    tokenDecimals: 18,
    redemptionBasisPoints,
    minProfitBps: 0,
    isStable: false,
    isShortable: true,
    symbol: "btc"
  })

  await sendTxn(vaultPriceFeed.setTokenConfig(
    eth.address, // _token
    ethPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(eth)")

  await setVaultTokenConfig({
    vault,
    token: eth,
    tokenDecimals: 18,
    redemptionBasisPoints,
    minProfitBps: 0,
    isStable: false,
    isShortable: true,
    symbol: "eth"
  })

  await sendTxn(vaultPriceFeed.setTokenConfig(
    bnb.address, // _token
    bnbPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(bnb)")

  await setVaultTokenConfig({
    vault,
    token: bnb,
    tokenDecimals: 18,
    redemptionBasisPoints,
    minProfitBps: 0,
    isStable: false,
    isShortable: true,
    symbol: "bnb"
  })

  await sendTxn(vaultPriceFeed.setTokenConfig(
    busd.address, // _token
    busdPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(busd)")

  await setVaultTokenConfig({
    vault,
    token: busd,
    tokenDecimals: 18,
    redemptionBasisPoints,
    minProfitBps: 0,
    isStable: true,
    isShortable: false,
    symbol: "busd"
  })

  await sendTxn(vaultPriceFeed.setTokenConfig(
    usdc.address, // _token
    usdcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(usdc)")

  await setVaultTokenConfig({
    vault,
    token: usdc,
    tokenDecimals: 18,
    redemptionBasisPoints,
    minProfitBps: 0,
    isStable: true,
    isShortable: false,
    symbol: "usdc"
  })

  await sendTxn(vaultPriceFeed.setTokenConfig(
    usdt.address, // _token
    usdtPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(usdt)")

  await setVaultTokenConfig({
    vault,
    token: usdt,
    tokenDecimals: 18,
    redemptionBasisPoints,
    minProfitBps: 0,
    isStable: true,
    isShortable: false,
    symbol: "usdt"
  })
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
