const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const vaultPriceFeed1 = await contractAt("VaultPriceFeed", "0xe700db0f0e609cc92ed521c0e956f8e915d9ac1b")
  const vaultPriceFeed2 = await contractAt("VaultPriceFeed", "0xf0313A44bE7e39Da035Ec581998314520aE42749")
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
    console.log(`${token.symbol} max1: ${ethers.utils.formatUnits(maxPrice1, usdDecimals)}`)
    console.log(`${token.symbol} min1: ${ethers.utils.formatUnits(minPrice1, usdDecimals)}`)
    console.log(`${token.symbol} diff1: ${ethers.utils.formatUnits(diff1, usdDecimals)}`)
    console.log(`${token.symbol} max2: ${ethers.utils.formatUnits(maxPrice2, usdDecimals)}`)
    console.log(`${token.symbol} min2: ${ethers.utils.formatUnits(minPrice2, usdDecimals)}`)
    console.log(`${token.symbol} diff2: ${ethers.utils.formatUnits(diff2, usdDecimals)}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
