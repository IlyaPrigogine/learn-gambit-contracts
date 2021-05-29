const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];

async function main() {
  const vault = await contractAt(
    "Vault", 
    "0x1B183979a5cd95FAF392c8002dbF0D5A1C687D9a"
  )
  const vaultPriceFeed = await contractAt(
    "VaultPriceFeed",
    "0xDa45f13847Cdb4317a5eBB40c8DbF7eAfAaE845c"
  )
  const redemptionBasisPoints = 10000

  const {
    btcPriceFeed,
    ethPriceFeed,
    bnbPriceFeed,
    busdPriceFeed,
    usdcPriceFeed,
    usdtPriceFeed,
    btc,
    eth,
    bnb,
    busd,
    usdc,
    usdt
  } = tokens;

  await sendTxn(vaultPriceFeed.setTokenConfig(
    btc.address, // _token
    btcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(btc)")

  await sendTxn(vault.setTokenConfig(
    btc.address, // _token
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ), "vault.setTokenConfig(btc)")

  await sendTxn(vaultPriceFeed.setTokenConfig(
    eth.address, // _token
    ethPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(eth)")

  await sendTxn(vault.setTokenConfig(
    eth.address, // _token
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ), "vault.setTokenConfig(eth)")

  await sendTxn(vaultPriceFeed.setTokenConfig(
    bnb.address, // _token
    bnbPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    bnb.address, // _token
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vaultPriceFeed.setTokenConfig(
    busd.address, // _token
    busdPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(busd)")

  await sendTxn(vault.setTokenConfig(
    busd.address, // _token
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    true, // _isStable
    false // _isShortable
  ), "vault.setTokenConfig(busd)")

  await sendTxn(vaultPriceFeed.setTokenConfig(
    usdc.address, // _token
    usdcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(usdc)")

  await sendTxn(vault.setTokenConfig(
    usdc.address, // _token
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    true, // _isStable
    false // _isShortable
  ), "vault.setTokenConfig(usdc)")

  await sendTxn(vaultPriceFeed.setTokenConfig(
    usdt.address, // _token
    usdtPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  ), "vaultPriceFeed.setTokenConfig(usdt)")

  await sendTxn(vault.setTokenConfig(
    usdt.address, // _token
    18, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    true, // _isStable
    false // _isShortable
  ), "vault.setTokenConfig(usdt)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
