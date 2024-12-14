import { ethers } from 'hardhat';
import { MinterHandler__factory } from '../typechain-types';

async function main() {
  // Address of the deployed MinterHandler contract
  const minterHandlerAddress = '0x5042eeA39971efDC93233a4884eEf93B3171c46e';

  // Address of the custodial to be added
  const custodialAddress = '0x0db2a8aa2e2c023cfb61c617d40162cc9f4c27ab';

  // Attach MinterHandler to the contract address
  const MinterFactory = await ethers.getContractFactory('MinterHandler');
  const minterHandler = MinterFactory.attach(minterHandlerAddress);

  try {
    // Call the custodialWallet function
    const tx = await minterHandler.setCustodialWallet(custodialAddress);

    // Wait for the transaction to be mined
    await tx.wait();

    console.log(
      `Successfully added custodial address ${custodialAddress} to MinterHandler`
    );
  } catch (error) {
    console.error('Error adding custodial address:', error);
    throw error;
  }
}

// Execute the script
main()
  .then(() => {
    console.log('Script completed successfully');
    return true;
  })
  .catch((error) => {
    console.error('Script failed:', error);
    throw error;
  });
