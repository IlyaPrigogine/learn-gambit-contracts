const { deployContract } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const weth = { address: "<TODO FILL IN ADDRESS>" }
  const vault = await deployContract("Vault", [])
  const usdg = await deployContract("USDG", [vault.address])
  const router = await deployContract("Router", [vault.address, usdg.address, weth.address])
  await vault.initialize(router.address, usdg.address, expandDecimals(2000 * 1000, 18), toUsd(5), 600)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
