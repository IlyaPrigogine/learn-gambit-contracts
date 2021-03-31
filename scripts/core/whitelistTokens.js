const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const vault = await contractAt("Vault", "0x1c7D2dfA7FEc362316a113970b6c53EC62A1C2c2")

  const btc = { address: "0xBc9BC47A7aB63db1E0030dC7B60DDcDe29CF4Ffb" }
  const eth = { address: "0xBCDCaF67193Bf5C57be08623278fCB69f4cA9e68" }
  const bnb = { address: "0xe0d4662cdfa2d71477A7DF367d5541421FAC2547" }
  const link = { address: "0x95c648267229b27C74180C0c1f0FA94e49567ECB" }
  const busd = { address: "0x6a260903f527EB53B243b5BB6FF3da6B6F28E5B0" }

  await sendTxn(vault.setTokenConfig(
    btc.address, // _token
    "0x5741306c21795FdCBb9b265Ea0255F499DFe515C", // _priceFeed
    8, // _priceDecimals
    8, // _tokenDecimals
    10000, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(btc)")

  await sendTxn(vault.setTokenConfig(
    eth.address, // _token
    "0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    10000, // _redemptionBps
    75, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(eth)")

  await sendTxn(vault.setTokenConfig(
    bnb.address, // _token
    "0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    10000, // _redemptionBps
    125, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    link.address, // _token
    "0x1B329402Cb1825C6F30A0d92aB9E2862BE47333f", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    9000, // _redemptionBps
    125, // _minProfitBps
    false // _isStable
  ), "vault.setTokenConfig(bnb)")

  await sendTxn(vault.setTokenConfig(
    busd.address, // _token
    "0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa", // _priceFeed
    8, // _priceDecimals
    18, // _tokenDecimals
    9000, // _redemptionBps
    125, // _minProfitBps
    true // _isStable
  ), "vault.setTokenConfig(busd)")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
