require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");
let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync("./config.json", "utf8"));
} catch {}
const POLYGON_RPC_URL = cfg.rpcUrl || process.env.POLYGON_RPC_URL || "";
const PK = cfg.privateKey || process.env.PRIVATE_KEY || "";
const ACCOUNTS = PK ? [PK.startsWith("0x") ? PK : `0x${PK}`] : [];

module.exports = {
  solidity: "0.8.20",
  networks: {
    polygonMumbai: {
      url: POLYGON_RPC_URL || "",
      accounts: ACCOUNTS,
    },
  },
};
