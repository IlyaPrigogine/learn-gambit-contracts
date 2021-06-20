const { deployContract, contractAt , sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
	const orderBook = await deployContract("OrderBook", []);

	await sendTxn(orderBook.initialize(
		"0x10800f683aa564534497a5b67F45bE3556a955AB", // router
		"0x1B183979a5cd95FAF392c8002dbF0D5A1C687D9a", // vault
		"0x612777eea37a44f7a95e3b101c39e1e2695fa6c2", // weth
		"0x2D549bdBf810523fe9cd660cC35fE05f0FcAa028", // usdg
		500000, // min execution fee
		expandDecimals(5, 30) // min purchase token amount usd
	));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
