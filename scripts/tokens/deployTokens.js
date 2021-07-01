const { deployContract, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  await deployContract("FaucetToken", ["Bitcoin", "BTC", 18, "1800000"])
  await deployContract("FaucetToken", ["Ethereum", "ETH", 18, "560000000000000000"])
  await deployContract("WETH", ["Binance Coin", "BNB", 18])
  await deployContract("FaucetToken", ["Binance USD", "BUSD", 18, expandDecimals(1000, 18)])
  const busdPriceFeed = await deployContract("PriceFeed", [])
  await sendTxn(busdPriceFeed.setLatestAnswer(100000000), "busdPriceFeed.setLatestAnswer")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
