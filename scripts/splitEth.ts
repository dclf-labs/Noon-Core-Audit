import dotenv from 'dotenv';
import { ethers } from 'hardhat';

dotenv.config();

async function splitEth(
  senderPrivateKey: string,
  recipientAddresses: string[],
  amountPerWallet: string
) {
  // Connect to the Ethereum network
  const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);

  // Create a wallet instance
  const wallet = new ethers.Wallet(senderPrivateKey, provider);

  // Convert the amount to wei
  const amountWei = ethers.parseEther(amountPerWallet);

  for (const recipientAddress of recipientAddresses) {
    try {
      // Create and send the transaction
      const tx = await wallet.sendTransaction({
        to: recipientAddress,
        value: amountWei,
      });

      console.log(`Transaction sent to ${recipientAddress}. Hash: ${tx.hash}`);

      // Wait for the transaction to be mined
      await tx.wait();
      console.log(`Transaction to ${recipientAddress} confirmed.`);
    } catch (error) {
      console.error(`Error sending to ${recipientAddress}:`, error);
    }
  }
}

// Usage example
const senderPrivateKey = String(process.env.SENDER_PRIVATE_KEY);
const recipientAddresses = [
  '0x1234567890123456789012345678901234567890',
  '0x0987654321098765432109876543210987654321',
  // Add more addresses as needed
];
const amountPerWallet = '0.1'; // Amount in ETH

splitEth(senderPrivateKey, recipientAddresses, amountPerWallet)
  .then(() => console.log('ETH split completed'))
  .catch((error) => console.error('Error splitting ETH:', error));
