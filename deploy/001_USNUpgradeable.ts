import { run } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { layerZeroConfig } from '../layerzero.config';
import { USNUpgradeable__factory } from '../typechain-types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const upgrades = await hre.upgrades;
  const networkName = hre.network.name;

  console.log('Deploying contracts with the account:', deployer);
  console.log(
    'Account balance:',
    (await hre.ethers.provider.getBalance(deployer)).toString()
  );

  // Get the LayerZero endpoint for the current network
  const lzEndpoint =
    networkName == 'hardhat'
      ? hre.ethers.ZeroAddress
      : layerZeroConfig.networks[networkName].endpoint;

  const USNUpgradeableFactory = (await hre.ethers.getContractFactory(
    'USNUpgradeable'
  )) as USNUpgradeable__factory;

  const usnUpgradeable = await upgrades.deployProxy(
    USNUpgradeableFactory,
    ['USN', 'USN', deployer],
    {
      initializer: 'initialize',
      constructorArgs: [lzEndpoint],
      unsafeAllow: ['constructor'],
    }
  );
  console.log(['USN', 'USN', lzEndpoint, deployer]);

  await usnUpgradeable.waitForDeployment();
  console.log('USNUpgradeable deployed to:', usnUpgradeable.target);

  // Deploy MinterHandler
  const minterHandler = await deploy('MinterHandler', {
    from: deployer,
    args: [usnUpgradeable.target],
    log: true,
  });
  console.log('MinterHandler deployed to:', minterHandler.address);

  // Deploy StakingVault
  const stakingVault = await deploy('StakingVault', {
    from: deployer,
    args: [usnUpgradeable.target, 'Staked USN', 'sUSN'],
    log: true,
  });
  console.log('StakingVault deployed to:', stakingVault.address);

  // Configure USN Token
  await usnUpgradeable.setAdmin(minterHandler.address);
  console.log('MinterHandler set as admin for USN');

  // Set custodial wallet (replace with actual Safe/Ceffu wallet address)
  const custodialWallet = '0x...'; // Replace with actual address
  const minterHandlerContract = await hre.ethers.getContractAt(
    'MinterHandler',
    minterHandler.address
  );
  await minterHandlerContract.setCustodialWallet(custodialWallet);
  console.log('Custodial wallet set for USN');

  // Set mint limit per block
  const mintLimitPerBlock = hre.ethers.parseEther('1000'); // Adjust as needed
  await minterHandlerContract.setMintLimitPerBlock(mintLimitPerBlock);
  console.log('Mint limit per block set for USN');

  // Configure StakingVault
  const withdrawPeriod = 7 * 24 * 60 * 60; // 7 days in seconds
  const stakingVaultContract = await hre.ethers.getContractAt(
    'StakingVault',
    stakingVault.address
  );
  await stakingVaultContract.setWithdrawPeriod(withdrawPeriod);
  console.log('Withdraw period set for StakingVault');

  // Set rebase manager (replace with actual address)
  const rebaseManager = '0x...'; // Replace with actual address
  await stakingVaultContract.setRebaseManager(rebaseManager);
  console.log('Rebase manager set for StakingVault');

  // Access Control Setup
  const DEFAULT_ADMIN_ROLE = await minterHandlerContract.DEFAULT_ADMIN_ROLE();
  const MINTER_ROLE = await minterHandlerContract.MINTER_ROLE();
  const BLACKLIST_MANAGER_ROLE =
    await stakingVaultContract.BLACKLIST_MANAGER_ROLE();
  const REBASE_MANAGER_ROLE = await stakingVaultContract.REBASE_MANAGER_ROLE();

  // Create separate accounts for each role (replace with actual addresses)
  const adminAccount = '0x...';
  const minterAccount = '0x...';
  const blacklistManagerAccount = '0x...';
  const rebaseManagerAccount = '0x...';

  // Grant roles
  await minterHandlerContract.grantRole(DEFAULT_ADMIN_ROLE, adminAccount);
  await minterHandlerContract.grantRole(MINTER_ROLE, minterAccount);
  await stakingVaultContract.grantRole(
    BLACKLIST_MANAGER_ROLE,
    blacklistManagerAccount
  );
  await stakingVaultContract.grantRole(
    REBASE_MANAGER_ROLE,
    rebaseManagerAccount
  );
  console.log('Roles granted to respective accounts');

  // Transfer DEFAULT_ADMIN_ROLE to a multi-sig wallet for enhanced security
  const multiSigWallet = '0x...'; // Replace with actual multi-sig wallet address
  await minterHandlerContract.grantRole(DEFAULT_ADMIN_ROLE, multiSigWallet);
  await minterHandlerContract.revokeRole(DEFAULT_ADMIN_ROLE, deployer);
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
    address: minterHandler.address,
    constructorArguments: [usnUpgradeable.target],
  });
  console.log('MinterHandler verified on Etherscan');

  await run('verify:verify', {
    address: stakingVault.address,
    constructorArguments: [usnUpgradeable.target, 'Staked USN', 'sUSN'],
  });
  console.log('StakingVault verified on Etherscan');
  console.log('Deployment completed successfully');
};

func.tags = ['USN'];

export default func;
