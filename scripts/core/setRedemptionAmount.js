const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

const network = (process.env.HARDHAT_NETWORK || 'mainnet');
const tokens = require('./tokens')[network];

async function main() {
  const vault = await contractAt("Vault", "0xc73A8DcAc88498FD4b4B1b2AaA37b0a2614Ff67B")
  const gov = await contractAt("Timelock", "0x58d6e1675232496226D074502D0c2df383fA0cBe")

  // await sendTxn(gov.setMaxDebtBasisPoints(vault.address, 50000), "gov.setMaxDebtBasisPoints")

  // console.log("vault.maxDebtBasisPoints", (await vault.maxDebtBasisPoints()).toString())

  await sendTxn(gov.setTokenConfig(vault.address, tokens.btc.address, 50000, 150), "gov.setTokenConfig(btc)")
  await sendTxn(gov.setTokenConfig(vault.address, tokens.eth.address, 50000, 150), "gov.setTokenConfig(eth)")
  await sendTxn(gov.setTokenConfig(vault.address, tokens.bnb.address, 50000, 150), "gov.setTokenConfig(bnb)")
  // console.log("vault.redemptionBasisPoints(btc)", (await vault.redemptionBasisPoints(tokens.btc.address)).toString())
  // console.log("vault.redemptionBasisPoints(eth)", (await vault.redemptionBasisPoints(tokens.eth.address)).toString())
  // console.log("vault.redemptionBasisPoints(bnb)", (await vault.redemptionBasisPoints(tokens.bnb.address)).toString())

  console.log("vault.minProfitBasisPoints(btc)", (await vault.minProfitBasisPoints(tokens.btc.address)).toString())
  console.log("vault.minProfitBasisPoints(eth)", (await vault.minProfitBasisPoints(tokens.eth.address)).toString())
  console.log("vault.minProfitBasisPoints(bnb)", (await vault.minProfitBasisPoints(tokens.bnb.address)).toString())
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
