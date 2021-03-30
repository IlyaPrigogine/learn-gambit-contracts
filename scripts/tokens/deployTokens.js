const { deployContract } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  await deployContract("FaucetToken", ["Bitcoin", "BTC", 8, "1800000"])
  await deployContract("FaucetToken", ["Ethereum", "ETH", 18, "560000000000000000"])
  await deployContract("WETH", ["Binance Coin", "BNB", 18])
  await deployContract("FaucetToken", ["Chainlink", "LINK", 18, expandDecimals(33, 18)])
  await deployContract("FaucetToken", ["Binance USD", "BUSD", 18, expandDecimals(1000, 18)])
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
