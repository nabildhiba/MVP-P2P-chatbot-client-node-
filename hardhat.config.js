require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync("./config.json", "utf8"));
} catch {}
const POLYGON_RPC_URL = cfg.rpcUrl || process.env.POLYGON_RPC_URL || "";
const PRIVATE_KEY = cfg.privateKey || process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: "0.8.20",
  networks: {
    polygonMumbai: {
      url: POLYGON_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
