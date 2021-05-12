const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const router = await contractAt("Router", "0xD46B23D042E976F8666F554E928e0Dc7478a8E1f")
  const vault = await contractAt("Vault", "0xc73A8DcAc88498FD4b4B1b2AaA37b0a2614Ff67B")
  const gov = await contractAt("Timelock", "0x330EeF6b9B1ea6EDd620C825c9919DC8b611d5d5")

  const tokenDecimals = 18

  const btc = {
    address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
    amount: "0.0412"
  }
  const eth = {
    address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
    amount: "5.6775"
  }
  const bnb = {
    address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    amount: "39.8377"
  }
  const busd = {
    address: "0xe9e7cea3dedca5984780bafc599bd69add087d56",
    amount: "10228.1919"
  }
  const usdc = {
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    amount: "11095.6480"
  }
  const usdt = {
    address: "0x55d398326f99059fF775485246999027B3197955",
    amount: "1163.4386"
  }

  const tokens = [btc, eth, bnb, busd, usdc, usdt]

  // for (let i = 0; i < tokens.length; i++) {
  //   const token = await contractAt("YieldToken", tokens[i].address)
  //   const poolAmount = await vault.poolAmounts(token.address)
  //   const feeReserve = await vault.feeReserves(token.address)
  //   const balance = await token.balanceOf(vault.address)
  //   const vaultAmount = poolAmount.add(feeReserve)
  //   if (vaultAmount.gt(balance)) {
  //     console.log(`${token.address}: vaultAmount.gt(balance): ${vaultAmount.toString()}, ${balance.toString()}, ${vaultAmount.sub(balance).toString()}`)
  //   } else {
  //     console.log(`${token.address}: vaultAmount.lt(balance): ${vaultAmount.toString()}, ${balance.toString()}, ${balance.sub(vaultAmount).toString()}`)
  //   }
  // }

  for (let i = 0; i < tokens.length; i++) {
    const token = await contractAt("YieldToken", tokens[i].address)
    const poolAmount = await vault.poolAmounts(token.address)
    const balance = await token.balanceOf(vault.address)
    if (poolAmount.gt(balance)) {
      const amount = poolAmount.sub(balance).mul(110).div(100)
      console.log("transfer", token.address, amount.toString())
      await sendTxn(token.transfer(vault.address, amount), `token.transfer ${i}`)
    }
    const amount = ethers.utils.parseUnits(tokens[i].amount, tokenDecimals).div(2)
    console.log("sending", token.address, amount.toString())
    await sendTxn(router.directPoolDeposit(token.address, amount), `router.directPoolDeposit ${i}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
