function toUsd(value) {
  const normalizedValue = parseInt(value * Math.pow(10, 5))
  return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(25))
}

function toNormalizedPrice(value) {
  const normalizedValue = parseInt(value * Math.pow(10, 5))
  return ethers.BigNumber.from(normalizedValue).mul(ethers.BigNumber.from(10).pow(25))
}

module.exports = { toUsd, toNormalizedPrice }
