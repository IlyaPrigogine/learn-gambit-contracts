const { deployContract, contractAt } = require("../shared/helpers")

async function main() {
  await deployContract("OrderBookReader", [])
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
