const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")
const { toUsd } = require("../../test/shared/units")

async function main() {
  const weth = { address: "0x6A2345E019DB2aCC6007DCD3A69731F51D7Dca52" }
  const vault = await deployContract("Vault", [])
  const usdg = await deployContract("USDG", [vault.address])
  const router = await deployContract("Router", [vault.address, usdg.address, weth.address])
  // const vault = await contractAt("Vault", "0x96EE5959d640Bf6F7BdEcAf55E65Cb8b5fD09856")
  // const usdg = await contractAt("USDG", "0xd8fCB8ccEaB1e2EB7357C4E8483Fe0bb0AEEC8FF")
  // const router = await contractAt("Router", "0xb4f81Fa74e06b5f762A104e47276BA9b2929cb27")
  await sendTxn(vault.initialize(router.address, usdg.address, expandDecimals(20 * 1000 * 1000, 18), toUsd(5), 600), "vault.initialize")
  await sendTxn(vault.setFees(20, 4, 10, toUsd(5)), "vault.setFees")
  await sendTxn(vault.setPriceSampleSpace(1), "vault.setPriceSampleSpace")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
