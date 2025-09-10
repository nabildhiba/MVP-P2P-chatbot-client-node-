const { ethers } = require("hardhat");

async function main() {
  const initialSupply = ethers.parseEther("1000");
  const Token = await ethers.getContractFactory("P2PChatbotToken");
  const token = await Token.deploy(initialSupply);
  await token.waitForDeployment();
  console.log(`P2PChatbotToken deployed to: ${token.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
