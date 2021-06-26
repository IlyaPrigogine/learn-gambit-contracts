const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

<<<<<<< HEAD
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
=======
const shouldSetVaultTokenConfig = false

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
  if (!shouldSetVaultTokenConfig) { return }

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
  const vaultPriceFeed = await contractAt("VaultPriceFeed", "0x7Ae0f01A95DD8Ac3F6851228aBB01b2D94BD831c")
>>>>>>> 72ab2eae30d954d236c7a145dc5e0dd517a66612
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

<<<<<<< HEAD
  await sendTxn(vault.setTokenConfig(
    btc.address, // _token
    8, // _tokenDecimals
    redemptionBasisPoints, // _redemptionBps
    0, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ), "vault.setTokenConfig(btc)")
=======
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
>>>>>>> 72ab2eae30d954d236c7a145dc5e0dd517a66612

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
