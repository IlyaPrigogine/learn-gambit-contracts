const { expandDecimals } = require("../../shared/utilities")
const { toUsd } = require("../../shared/units")

async function initVault(vault, router, usdg) {
    await vault.initialize(
      router.address,
      usdg.address,
      expandDecimals(600 * 1000, 18),
      expandDecimals(100 * 1000, 18),
      toUsd(5),
      600
    )
}

module.exports = { initVault }
