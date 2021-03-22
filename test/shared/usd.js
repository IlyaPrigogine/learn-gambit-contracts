function toUsd(value) {
  return ethers.BigNumber.from(value).mul(ethers.BigNumber.from(10).pow(30))
}

module.exports = {
  toUsd
}
