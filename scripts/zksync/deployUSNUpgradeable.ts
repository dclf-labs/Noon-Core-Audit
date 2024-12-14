import { Options } from '@layerzerolabs/lz-v2-utilities';
import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { ethers, upgrades, network, run } from 'hardhat';
import * as hre from 'hardhat';
import { utils, Wallet, Provider } from 'zksync-ethers';
// Add sleep function
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const PRIVATE_KEY = process.env.DEPLOYER_WALLET_PRIVATE_KEY || '';
  // Create provider from npx
  const provider = new Provider(hre.config.networks.sophonTestnet.url);
  console.log('Connected to provider:', await provider.getNetwork());
  const wallet = new Wallet(PRIVATE_KEY, provider);
  console.log(wallet);
  const deployer = new Deployer(hre, wallet);
  const artifact = await deployer.loadArtifact('EndpointV2Mock');
  const networkName = network.name;
  console.log(deployer);

  // Deploy EndpointV2Mock
  console.log('Deploying EndpointV2Mock...');

  const paymasterParams = utils.getPaymasterParams(
    '0x950e3Bb8C6bab20b56a70550EC037E22032A413e', // Paymaster address
    {
      type: 'General',
      innerInput: new Uint8Array(),
    }
  );

  const endpointV2Mock = await deployer.deploy(artifact, [10], 'create', {
    //TODO : set up right eid
    customData: {
      paymasterParams: paymasterParams,
      gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
    },
  });

  await endpointV2Mock.waitForDeployment();
  const lzEndpoint = await endpointV2Mock.getAddress();
  console.log('EndpointV2Mock deployed to:', lzEndpoint);

  const USNUpgradeableFactory = await deployer.loadArtifact('USNUpgradeable');

  console.log('Deploying USNUpgradeable...');
  const usnUpgradeable = await hre.zkUpgrades.deployProxy(
    deployer.zkWallet,
    USNUpgradeableFactory,
    ['USN Token', 'USN', deployer.zkWallet.address],
    {
      initializer: 'initialize',
      constructorArgs: [lzEndpoint],
      unsafeAllow: ['constructor'],
      paymasterProxyParams: paymasterParams,
      paymasterImplParams: paymasterParams,
    }
  );

  await usnUpgradeable.waitForDeployment();

  console.log('USNUpgradeable deployed to:', await usnUpgradeable.getAddress());
  await sleep(60000);
  // Additional setup steps
  console.log('Setting admin...');
  await usnUpgradeable.setAdmin(deployer.zkWallet.address, {
    customData: {
      paymasterParams: paymasterParams,
      gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
    },
  });
  console.log('Admin set to:', deployer.zkWallet.address);

  console.log('Enabling permissionless mode...');
  await usnUpgradeable.enablePermissionless({
    customData: {
      paymasterParams: paymasterParams,
      gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
    },
  });
  console.log('Permissionless mode enabled');

  // Set enforced options
  const executorLzReceiveOptionMaxGas = 65000;
  console.log(`Setting enforced options...`);
  const options = Options.newOptions().addExecutorLzReceiveOption(
    BigInt(executorLzReceiveOptionMaxGas),
    0
  );
  const enforcedOptions = [
    {
      eid: 1, // Mock EID
      msgType: 1,
      options: options.toBytes(),
    },
  ];
  await usnUpgradeable.setEnforcedOptions(enforcedOptions, {
    customData: {
      paymasterParams: paymasterParams,
      gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
    },
  });
  console.log(`Enforced options set`);

  // Verify the contract on Etherscan or equivalent explorer
  console.log('Verifying contract on Explorer...');
  try {
    await run('verify:verify', {
      address: await usnUpgradeable.getAddress(),
      constructorArguments: [lzEndpoint],
    });
    console.log('Contract verified successfully');
  } catch (error) {
    console.error('Error verifying contract:', error);
  }

  console.log('Deployment and initial setup completed!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
