const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")

async function main() {
  const weth = { address: "0xe0d4662cdfa2d71477A7DF367d5541421FAC2547" }
  const vault = await deployContract("Vault", [])
  const usdg = await deployContract("USDG", [vault.address])
  const router = await deployContract("Router", [vault.address, usdg.address, weth.address])
  // const vault = await contractAt("Vault", "0x5F58D97B9eAc7093bD1801b4fa51B0f555A8DAD4")
  // const usdg = await contractAt("USDG", "0x2FFB16692eB2a875190C32c36B9E20A8c7e477a6")
  // const router = await contractAt("Router", "0xb4f81Fa74e06b5f762A104e47276BA9b2929cb27")
  // await sendTxn(vault.initialize(router.address, usdg.address, expandDecimals(2000 * 1000, 18), toUsd(5), 600), "vault.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
