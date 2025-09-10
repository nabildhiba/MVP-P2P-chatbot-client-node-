require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { POLYGON_RPC_URL, PRIVATE_KEY } = process.env;

module.exports = {
  solidity: "0.8.20",
  networks: {
    polygonMumbai: {
      url: POLYGON_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
