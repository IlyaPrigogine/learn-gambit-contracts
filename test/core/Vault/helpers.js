const { expandDecimals } = require("../../shared/utilities")
const { toUsd } = require("../../shared/units")

async function initVault(vault, router, usdg) {
    await vault.initialize(
      router.address,
      usdg.address,
      expandDecimals(600 * 1000, 18),
      expandDecimals(100 * 1000, 18),
      toUsd(5),
      600
    )
}

function getBnbConfig(bnb, bnbPriceFeed) {
  return [
    bnb.address, // _token
    bnbPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false, // _isStable
    false // _isStrictStable
  ]
}

function getBtcConfig(btc, btcPriceFeed) {
  return [
    btc.address, // _token
    btcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    8, // _tokenDecimals
    9000, // _redemptionBps
    75, // _minProfitBps
    false, // _isStable
    false // _isStrictStable
  ]
}

module.exports = { initVault, getBnbConfig, getBtcConfig }
