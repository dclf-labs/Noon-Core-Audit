import { ethers, upgrades, network, run } from 'hardhat';
import { layerZeroConfig } from '../layerzero.config';

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log('Deploying contracts with the account:', deployer.address);

  console.log(
    'Account balance:',
    (await ethers.provider.getBalance(deployer.address)).toString()
  );

  // Get the LayerZero endpoint for the current network
  const lzEndpoint = layerZeroConfig.networks[networkName].endpoint;

  const USNUpgradeableFactory = (await ethers.getContractFactory(
    'USNUpgradeable'
  )) as USNUpgradeable__factory;

  console.log('Deploying USNUpgradeable...');

  const usnUpgradeable = await upgrades.deployProxy(
    USNUpgradeableFactory,
    ['USN', 'USN', lzEndpoint, deployer.address],
    {
      initializer: 'initialize',
      constructorArgs: [lzEndpoint],
      unsafeAllow: ['constructor'],
    }
  );

  await usnUpgradeable.waitForDeployment();
  console.log('USNUpgradeable deployed to:', usnUpgradeable.target);

  // Deploy MinterHandler
  const MinterHandler = await ethers.getContractFactory('MinterHandler');
  const minterHandler = await MinterHandler.deploy(usnUpgradeable.target);
  await minterHandler.waitForDeployment();
  console.log('MinterHandler deployed to:', minterHandler.target);

  // Deploy StakingVault
  const StakingVault = await ethers.getContractFactory('StakingVault');
  const stakingVault = await StakingVault.deploy(
    usnUpgradeable.target,
    'Staked USN',
    'sUSN'
  );
  await stakingVault.waitForDeployment();
  console.log('StakingVault deployed to:', stakingVault.target);

  // Configure USN Token
  await usnUpgradeable.setAdmin(minterHandler.target);
  console.log('MinterHandler set as admin for USN');

  // Set custodial wallet (replace with actual Safe/Ceffu wallet address)
  const custodialWallet = '0x...'; // Replace with actual address
  await minterHandler.setCustodialWallet(custodialWallet);
  console.log('Custodial wallet set for USN');

  // Set mint limit per block
  const mintLimitPerBlock = ethers.parseEther('1000'); // Adjust as needed
  await minterHandler.setMintLimitPerBlock(mintLimitPerBlock);
  console.log('Mint limit per block set for USN');

  // Configure StakingVault
  const withdrawPeriod = 7 * 24 * 60 * 60; // 7 days in seconds
  await stakingVault.setWithdrawPeriod(withdrawPeriod);
  console.log('Withdraw period set for StakingVault');

  // Set rebase manager (replace with actual address)
  const rebaseManager = '0x...'; // Replace with actual address
  await stakingVault.setRebaseManager(rebaseManager);
  console.log('Rebase manager set for StakingVault');

  // Access Control Setup
  const DEFAULT_ADMIN_ROLE = await minterHandler.DEFAULT_ADMIN_ROLE();
  const MINTER_ROLE = await minterHandler.MINTER_ROLE();
  const BLACKLIST_MANAGER_ROLE = await stakingVault.BLACKLIST_MANAGER_ROLE();
  const REBASE_MANAGER_ROLE = await stakingVault.REBASE_MANAGER_ROLE();

  // Create separate accounts for each role (replace with actual addresses)
  const adminAccount = '0x...';
  const minterAccount = '0x...';
  const blacklistManagerAccount = '0x...';
  const rebaseManagerAccount = '0x...';

  // Grant roles
  await minterHandler.grantRole(DEFAULT_ADMIN_ROLE, adminAccount);
  await minterHandler.grantRole(MINTER_ROLE, minterAccount);
  await stakingVault.grantRole(BLACKLIST_MANAGER_ROLE, blacklistManagerAccount);
  await stakingVault.grantRole(REBASE_MANAGER_ROLE, rebaseManagerAccount);
  console.log('Roles granted to respective accounts');

  // Transfer DEFAULT_ADMIN_ROLE to a multi-sig wallet for enhanced security
  const multiSigWallet = '0x...'; // Replace with actual multi-sig wallet address
  await minterHandler.grantRole(DEFAULT_ADMIN_ROLE, multiSigWallet);
  await minterHandler.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
  // Transfer ownership of USN to the multi-sig wallet
  await usnUpgradeable.transferOwnership(multiSigWallet);
  console.log('USN ownership transferred to multi-sig wallet');

  // The multi-sig wallet will need to call acceptOwnership() to complete the transfer
  console.log(
    'Note: Multi-sig wallet needs to call acceptOwnership() on USN to complete the transfer'
  );
  console.log('DEFAULT_ADMIN_ROLE transferred to multi-sig wallet');
  // Verify contracts on Etherscan
  console.log('Verifying contracts on Etherscan...');

  await run('verify:verify', {
    address: usnUpgradeable.target,
    constructorArguments: [],
  });
  console.log('USN verified on Etherscan');

  await run('verify:verify', {
    address: minterHandler.target,
    constructorArguments: [usnUpgradeable.target],
  });
  console.log('MinterHandler verified on Etherscan');

  await run('verify:verify', {
    address: stakingVault.target,
    constructorArguments: [usnUpgradeable.target, 'Staked USN', 'sUSN'],
  });
  console.log('StakingVault verified on Etherscan');
  console.log('Deployment completed successfully');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
