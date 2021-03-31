const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")

async function main() {
  const weth = { address: "0xe0d4662cdfa2d71477A7DF367d5541421FAC2547" }
  const vault = await deployContract("Vault", [])
  const usdg = await deployContract("USDG", [vault.address])
  const router = await deployContract("Router", [vault.address, usdg.address, weth.address])
  // const vault = await contractAt("Vault", "0xD1e15B7f2AAa9B67008B983BF863272C5610408C")
  // const usdg = await contractAt("USDG", "0xFd0004f20bDF57f39c6999e7af02131b8402F4c2")
  // const router = await contractAt("Router", "0xb4f81Fa74e06b5f762A104e47276BA9b2929cb27")
  await sendTxn(vault.initialize(router.address, usdg.address, expandDecimals(2000 * 1000, 18), toUsd(5), 600), "vault.initialize")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
