import { ethers, upgrades } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { layerZeroConfig } from '../layerzero.config';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { get } = deployments;
  const { deployer } = await getNamedAccounts();
  const [owner] = await ethers.getSigners();
  const networkName = hre.network.name;

  console.log('Deploying contracts with the account:', deployer);
  console.log(
    'Account balance:',
    (await hre.ethers.provider.getBalance(deployer)).toString()
  );

  // Get USN address
  const usnAddress = '0x290FB57A91d2B5B4a22B39C8560052857c89d8A3';
  if (!usnAddress) {
    throw new Error('USN_ADDRESS not set in environment');
  }

  // Get the LayerZero endpoint for the current network
  const lzEndpoint =
    networkName == 'hardhat'
      ? hre.ethers.ZeroAddress
      : layerZeroConfig.networks[networkName].endpoint;

  // Deploy StakingVaultOFTUpgradeable
  const StakingVaultOFTFactory = await ethers.getContractFactory(
    'StakingVaultOFTUpgradeable'
  );

  console.log('Deploying StakingVaultOFTUpgradeable...');
  const stakingVaultOFT = await upgrades.deployProxy(
    StakingVaultOFTFactory,
    [
      usnAddress, // USN token address
      'Staked USN', // name
      'sUSN', // symbol
      deployer, // owner
    ],
    {
      initializer: 'initialize',
      constructorArgs: [lzEndpoint],
      unsafeAllow: ['constructor'],
    }
  );

  await stakingVaultOFT.waitForDeployment();
  console.log(
    'StakingVaultOFTUpgradeable deployed to:',
    await stakingVaultOFT.getAddress()
  );

  // Deploy WithdrawalHandler
  const WithdrawalHandlerFactory =
    await ethers.getContractFactory('WithdrawalHandler');
  const withdrawPeriod = 24 * 60 * 60; // 1 day in seconds
  const withdrawalHandler = await WithdrawalHandlerFactory.deploy(
    usnAddress,
    withdrawPeriod
  );
  await withdrawalHandler.waitForDeployment();
  console.log(
    'WithdrawalHandler deployed to:',
    await withdrawalHandler.getAddress()
  );

  // Set up roles and configurations
  console.log('Setting up roles and configurations...');

  // Grant STAKING_VAULT_ROLE to StakingVault in WithdrawalHandler
  const STAKING_VAULT_ROLE = await withdrawalHandler.STAKING_VAULT_ROLE();
  await withdrawalHandler.grantRole(
    STAKING_VAULT_ROLE,
    await stakingVaultOFT.getAddress()
  );
  console.log('Granted STAKING_VAULT_ROLE to StakingVault');

  // Set WithdrawalHandler in StakingVault
  await stakingVaultOFT.setWithdrawalHandler(
    await withdrawalHandler.getAddress()
  );
  console.log('Set WithdrawalHandler in StakingVault');

  // Set up roles
  const REBASE_MANAGER_ROLE = await stakingVaultOFT.REBASE_MANAGER_ROLE();
  const BLACKLIST_MANAGER_ROLE = await stakingVaultOFT.BLACKLIST_MANAGER_ROLE();

  // Set rebase manager (replace with actual address from env)
  const rebaseManager = deployer; //process.env.REBASE_MANAGER_ADDRESS;
  if (rebaseManager) {
    await stakingVaultOFT.grantRole(REBASE_MANAGER_ROLE, rebaseManager);
    console.log('Granted REBASE_MANAGER_ROLE to:', rebaseManager);
  }

  // Set blacklist manager (replace with actual address from env)
  const blacklistManager = deployer; //process.env.BLACKLIST_MANAGER_ADDRESS;
  if (blacklistManager) {
    await stakingVaultOFT.grantRole(BLACKLIST_MANAGER_ROLE, blacklistManager);
    console.log('Granted BLACKLIST_MANAGER_ROLE to:', blacklistManager);
  }

  // Verify contracts if on a supported network
  if (process.env.ETHERSCAN_API_KEY) {
    console.log('Verifying contracts...');

    // Verify StakingVaultOFTUpgradeable implementation
    const implementationAddress =
      await upgrades.erc1967.getImplementationAddress(
        await stakingVaultOFT.getAddress()
      );

    await verify(implementationAddress, [lzEndpoint]);
    console.log('Verified StakingVaultOFTUpgradeable implementation');

    // Verify WithdrawalHandler
    await verify(await withdrawalHandler.getAddress(), [
      usnAddress,
      withdrawPeriod,
    ]);
    console.log('Verified WithdrawalHandler');
  }

  console.log('\nDeployment Summary:');
  console.log('-------------------');
  console.log('Network:', networkName);
  console.log(
    'StakingVaultOFTUpgradeable:',
    await stakingVaultOFT.getAddress()
  );
  console.log('WithdrawalHandler:', await withdrawalHandler.getAddress());
  console.log('Owner:', deployer);
  console.log('LZ Endpoint:', lzEndpoint);
  // Approve and deposit initial liquidity
  const initialLiquidity = ethers.parseUnits('1', 18);
  const usn = await ethers.getContractAt('IERC20', usnAddress);

  console.log('\nSetting up initial liquidity...');
  console.log('--------------------------------');
  console.log('Approving USN spend:', initialLiquidity.toString());
  await usn.approve(await stakingVaultOFT.getAddress(), initialLiquidity);
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log('Depositing initial liquidity:', initialLiquidity.toString());
  await stakingVaultOFT.deposit(initialLiquidity, deployer);

  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log('Initial liquidity setup complete');

  console.log('\nUpdating withdrawal period...');
  console.log('--------------------------------');
  await withdrawalHandler.setWithdrawPeriod(1);
  console.log('Withdrawal period set to 1 second');
  console.log('\nWithdrawing staked tokens...');
  console.log('--------------------------------');
  const balance = await stakingVaultOFT.balanceOf(deployer);
  console.log('Balance:', balance.toString());
  if (balance > 0n) {
    console.log('Withdrawing balance:', balance.toString());
    await stakingVaultOFT.withdraw(
      balance,
      await withdrawalHandler.getAddress(),
      deployer
    );
    console.log('Withdrawal request created successfully');
  } else {
    console.log('No balance to withdraw');
  }

  // Wait briefly to ensure withdrawal period has passed
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const requestId = await withdrawalHandler.getUserNextRequestId(deployer);
  if (requestId > 0) {
    console.log(
      'Claiming withdrawal for request ID:',
      (requestId - 1n).toString()
    );
    await withdrawalHandler.claimWithdrawal(requestId - 1n);
    console.log('Withdrawal claimed successfully');
  } else {
    console.log('No withdrawal requests found to claim');
  }
};

func.tags = ['stakingVault'];

export default func;
