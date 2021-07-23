const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const vaultPriceFeed1 = await contractAt("VaultPriceFeed", "0x7780c24f502fd43a1d1bb8ad9438a03e6f1dcddc")
  const vaultPriceFeed2 = await contractAt("VaultPriceFeed", "0x66F1e3a12c8b583A24EbC1B22A1d5905C83b4B9c")
  const usdDecimals = 30

  const btc = {
    symbol: "BTC",
    address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c"
  }
  const eth = {
    symbol: "ETH",
    address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8"
  }
  const bnb = {
    symbol: "BNB",
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
  }
  const busd = {
    symbol: "BUSD",
    address: "0xe9e7cea3dedca5984780bafc599bd69add087d56"
  }
  const usdc = {
    symbol: "USDC",
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d"
  }
  const usdt = {
    symbol: "USDT",
    address: "0x55d398326f99059fF775485246999027B3197955"
  }

  const tokens = [btc, eth, bnb, busd, usdc, usdt]

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const maxPrice1 = await vaultPriceFeed1.getPrice(token.address, true, true)
    const maxPrice2 = await vaultPriceFeed2.getPrice(token.address, true, true)
    const minPrice1 = await vaultPriceFeed1.getPrice(token.address, false, true)
    const minPrice2 = await vaultPriceFeed2.getPrice(token.address, false, true)
    const diff1 = maxPrice1.sub(minPrice1)
    const diff2 = maxPrice2.sub(minPrice2)
    const spread1 = diff1.mul(1000000).div(minPrice1)
    const spread2 = diff2.mul(1000000).div(minPrice2)
    console.log(`------------ ${token.symbol} ------------`)
    console.log("\n1.")
    console.log(`max1: ${ethers.utils.formatUnits(maxPrice1, usdDecimals)}`)
    console.log(`min1: ${ethers.utils.formatUnits(minPrice1, usdDecimals)}`)
    console.log(`diff1: ${ethers.utils.formatUnits(diff1, usdDecimals)}`)
    console.log(`spread1: ${ethers.utils.formatUnits(spread1, 4)}`)
    console.log("\n2.")
    console.log(`max2: ${ethers.utils.formatUnits(maxPrice2, usdDecimals)}`)
    console.log(`min2: ${ethers.utils.formatUnits(minPrice2, usdDecimals)}`)
    console.log(`diff2: ${ethers.utils.formatUnits(diff2, usdDecimals)}`)
    console.log(`spread2: ${ethers.utils.formatUnits(spread2, 4)}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
