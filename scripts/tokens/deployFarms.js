const { deployContract, contractAt, sendTxn } = require("../shared/helpers")
const { expandDecimals } = require("../../test/shared/utilities")

async function main() {
  const usdg = await contractAt("USDG", "0xE14F46Ee1e23B68003bCED6D85465455a309dffF")
  const wbnb = await contractAt("WETH", "0x6A2345E019DB2aCC6007DCD3A69731F51D7Dca52")
  const xgmt = await contractAt("YieldToken", "0x28cba798eca1a3128ffd1b734afb93870f22e613")

  const gmtUsdgPair = { address: "0xe0b0a315746f51932de033ab27223d85114c6b85" }
  const gmtUsdgFarm = await deployContract("YieldFarm", ["GMT-USDG Farm", "GMT-USDG:FARM", gmtUsdgPair.address], "gmtUsdgFarm")

  const xgmtUsdgPair = { address: "0x0108de1eea192ce8448080c3d90a1560cf643fa0" }
  const xgmtUsdgFarm = await deployContract("YieldFarm", ["xGMT-USDG Farm", "xGMT-USDG:FARM", xgmtUsdgPair.address], "xgmtUsdgFarm")

  const usdgYieldTracker = await deployContract("YieldTracker", [usdg.address], "usdgYieldTracker")
  const usdgRewardDistributor = await deployContract("TimeDistributor", [], "usdgRewardDistributor")

  await sendTxn(usdg.setYieldTrackers([usdgYieldTracker.address]), "usdg.setYieldTrackers")
  await sendTxn(usdgYieldTracker.setDistributor(usdgRewardDistributor.address), "usdgYieldTracker.setDistributor")
  await sendTxn(usdgRewardDistributor.setDistribution([usdgYieldTracker.address], ["500000000000000000"], [wbnb.address]), "usdgRewardDistributor.setDistribution")

  const xgmtYieldTracker = await deployContract("YieldTracker", [xgmt.address], "xgmtYieldTracker")
  const xgmtRewardDistributor = await deployContract("TimeDistributor", [], "xgmtRewardDistributor")

  await sendTxn(xgmt.setYieldTrackers([xgmtYieldTracker.address]), "xgmt.setYieldTrackers")
  await sendTxn(xgmtYieldTracker.setDistributor(xgmtRewardDistributor.address), "xgmtYieldTracker.setDistributor")
  await sendTxn(xgmtRewardDistributor.setDistribution([xgmtYieldTracker.address], ["500000000000000000"], [wbnb.address]), "xgmtRewardDistributor.setDistribution")

  const gmtUsdgFarmYieldTrackerXgmt = await deployContract("YieldTracker", [gmtUsdgFarm.address], "gmtUsdgFarmYieldTrackerXgmt")
  const gmtUsdgFarmDistributorXgmt = await deployContract("TimeDistributor", [], "gmtUsdgFarmDistributorXgmt")

  await sendTxn(gmtUsdgFarmYieldTrackerXgmt.setDistributor(gmtUsdgFarmDistributorXgmt.address), "gmtUsdgFarmYieldTrackerXgmt.setDistributor")
  await sendTxn(gmtUsdgFarmDistributorXgmt.setDistribution([gmtUsdgFarmYieldTrackerXgmt.address], ["5952380952380000000"], [xgmt.address]), "gmtUsdgFarmDistributorXgmt.setDistribution")

  const gmtUsdgFarmYieldTrackerWbnb = await deployContract("YieldTracker", [gmtUsdgFarm.address], "gmtUsdgFarmYieldTrackerWbnb")
  const gmtUsdgFarmDistributorWbnb = await deployContract("TimeDistributor", [], "gmtUsdgFarmDistributorWbnb")

  await sendTxn(gmtUsdgFarmYieldTrackerWbnb.setDistributor(gmtUsdgFarmDistributorWbnb.address), "gmtUsdgFarmYieldTrackerWbnb.setDistributor")
  await sendTxn(gmtUsdgFarmDistributorWbnb.setDistribution([gmtUsdgFarmYieldTrackerWbnb.address], ["500000000000000000"], [wbnb.address]), "gmtUsdgFarmDistributorWbnb.setDistribution")

  await sendTxn(gmtUsdgFarm.setYieldTrackers([gmtUsdgFarmYieldTrackerXgmt.address, gmtUsdgFarmYieldTrackerWbnb.address]), "gmtUsdgFarm.setYieldTrackers")

  const xgmtUsdgFarmYieldTrackerXgmt = await deployContract("YieldTracker", [xgmtUsdgFarm.address], "xgmtUsdgFarmYieldTrackerXgmt")
  const xgmtUsdgFarmDistributorXgmt = await deployContract("TimeDistributor", [], "xgmtUsdgFarmDistributorXgmt")

  await sendTxn(xgmtUsdgFarmYieldTrackerXgmt.setDistributor(xgmtUsdgFarmDistributorXgmt.address), "xgmtUsdgFarmYieldTrackerXgmt.setDistributor")
  await sendTxn(xgmtUsdgFarmDistributorXgmt.setDistribution([xgmtUsdgFarmYieldTrackerXgmt.address], ["11904761904800000000"], [xgmt.address]), "xgmtUsdgFarmDistributorXgmt.setDistribution")

  const xgmtUsdgFarmYieldTrackerWbnb = await deployContract("YieldTracker", [xgmtUsdgFarm.address], "xgmtUsdgFarmYieldTrackerWbnb")
  const xgmtUsdgFarmDistributorWbnb = await deployContract("TimeDistributor", [], "xgmtUsdgFarmDistributorWbnb")

  await sendTxn(xgmtUsdgFarmYieldTrackerWbnb.setDistributor(xgmtUsdgFarmDistributorWbnb.address), "xgmtUsdgFarmYieldTrackerWbnb.setDistributor")
  await sendTxn(xgmtUsdgFarmDistributorWbnb.setDistribution([xgmtUsdgFarmYieldTrackerWbnb.address], ["500000000000000000"], [wbnb.address]), "gmtUsdgFarmDistributorWbnb.setDistribution")

  await sendTxn(xgmtUsdgFarm.setYieldTrackers([xgmtUsdgFarmYieldTrackerXgmt.address, xgmtUsdgFarmYieldTrackerWbnb.address]), "xgmtUsdgFarm.setYieldTrackers")
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
