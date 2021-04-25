const { expandDecimals } = require("../../shared/utilities")
const { toUsd } = require("../../shared/units")

async function initVault(vault, router, usdg, priceFeed) {
    await vault.initialize(
      router.address, // router
      usdg.address, // usdg
      priceFeed.address, // priceFeed
      expandDecimals(600 * 1000, 18), // maxUsdgBatchSize
      expandDecimals(100 * 1000, 18), // maxUsdgBuffer
      toUsd(5), // liquidationFeeUsd
      600, // fundingRateFactor
      10000000000, // maxGasPrice, 10 gwei
      20000 // maxDebtBasisPoints
    )
}

function getBnbConfig(bnb, bnbPriceFeed) {
  return [
    bnb.address, // _token
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ]
}

function getEthConfig(eth, ethPriceFeed) {
  return [
    eth.address, // _token
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ]
}

function getBtcConfig(btc, btcPriceFeed) {
  return [
    btc.address, // _token
    8, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false, // _isStable
    true // _isShortable
  ]
}

function getDaiConfig(dai, daiPriceFeed) {
  return [
    dai.address, // _token
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    true, // _isStable
    false // _isShortable
  ]
}

module.exports = { initVault, getBnbConfig, getBtcConfig, getEthConfig, getDaiConfig }
