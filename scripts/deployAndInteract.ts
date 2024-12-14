import { ethers } from 'hardhat';

async function main() {
  const USNName = 'USN';
  const USNFactory = await ethers.getContractFactory(USNName);
  const USN = await USNFactory.deploy();
  await USN.waitForDeployment();
  const USNAddress = await USN.getAddress();
  console.log(USNName + ' deployed to:', USNAddress);

  // Get the owner's address
  const [owner] = await ethers.getSigners();
  // Sleep
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Set the minter (assuming the owner is the minter)
  await USN.setAdmin(owner.address);
  console.log('Minter set to:', owner.address);

  // Sleep
  await new Promise((resolve) => setTimeout(resolve, 5000));
  // Mint to owner
  await USN.mint(owner.address, ethers.parseEther('1000000000'));
  console.log('Minted 100000000000000 USN to owner');

  // Generate 5 random addresses and mint tokens
  const mintAmount = ethers.parseEther('1000'); // 1000 USN
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const randomWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await USN.mint(randomWallet.address, mintAmount);
    console.log(
      `Minted ${ethers.formatEther(mintAmount)} USN to ${randomWallet.address}`
    );
  }

  // Perform some transfers from the owner
  const transferAmount = ethers.parseEther('100'); // 100 USN
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const randomWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await USN.transfer(randomWallet.address, transferAmount);
    console.log(
      `Transferred ${ethers.formatEther(transferAmount)} USN from owner to ${
        randomWallet.address
      }`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
