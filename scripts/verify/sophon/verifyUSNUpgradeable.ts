aimport { run, network } from 'hardhat';

async function main() {
  console.log('Network:', network.name);
  const proxyAddress = '0x0469d9d1dE0ee58fA1153ef00836B9BbCb84c0B6';
  const proxyAdminAddress = '0x5a82384A042cCe41f9aC6F0C110773E5B3266F11';
  const implementationAddress = '0xc3068D1deAEd95bf821DE67f560A353600e8A07a';

  console.log('Verifying Proxy contract...');
  try {
    await run('verify:verify', {
      address: proxyAddress,
      constructorArguments: [
        '0x5c6cfF4b7C49805F8295Ff73C204ac83f3bC4AE7', // LayerZero endpoint for Sophon
      ],
      contract:
        '@matterlabs/hardhat-zksync-upgradable/proxy/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',

      force: true,
    });
    await run('verify:verify', {
      address: proxyAddress,
      constructorArguments: [
        '0xc3068D1deAEd95bf821DE67f560A353600e8A07a',
        proxyAdminAddress,
        '0x', // empty bytes for initialization data
      ],
      contract:
        '@matterlabs/hardhat-zksync-upgradable/proxy/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
      force: true,
    });
    console.log('Proxy contract verified successfully');
  } catch (error) {
    console.error('Error verifying Proxy contract:', error);
  }

  console.log('Verifying ProxyAdmin contract...');
  try {
    await run('verify:verify', {
      address: proxyAdminAddress,
      constructorArguments: [],
      force: true,
    });
    console.log('ProxyAdmin contract verified successfully');
  } catch (error) {
    console.error('Error verifying ProxyAdmin contract:', error);
  }

  console.log('Verifying Implementation contract...');
  try {
    await run('verify:verify', {
      address: implementationAddress,
      constructorArguments: [
        '0x5c6cfF4b7C49805F8295Ff73C204ac83f3bC4AE7', // LayerZero endpoint for Sophon
      ],
      force: true,
    });
    console.log('Implementation contract verified successfully');
  } catch (error) {
    console.error('Error verifying Implementation contract:', error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
