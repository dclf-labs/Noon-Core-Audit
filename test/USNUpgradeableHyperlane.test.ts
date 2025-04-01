import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { USNUpgradeableHyperlane } from '../typechain-types';

describe('USNUpgradeableHyperlane', function () {
  let usnSrc: USNUpgradeableHyperlane;
  let usnDst: USNUpgradeableHyperlane;
  let mockMailboxSrc: any;
  let endpointV2MockSrc: any;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let admin: SignerWithAddress;

  const CHAIN_ID_SRC = 1;
  const initialMint = ethers.parseEther('1000000');
  const transferAmount = ethers.parseEther('100');
  const MOCK_FEE = ethers.parseEther('0.001');

  async function deployFixture() {
    [owner, user1, user2, admin] = await ethers.getSigners();

    // Deploy mock LZ endpoints
    const EndpointV2Mock = await ethers.getContractFactory('EndpointV2Mock');
    endpointV2MockSrc = await EndpointV2Mock.deploy(CHAIN_ID_SRC);
    await endpointV2MockSrc.waitForDeployment();

    // Deploy mock contracts for source chain
    const MockMailbox = await ethers.getContractFactory('MockMailbox');
    mockMailboxSrc = await MockMailbox.deploy(CHAIN_ID_SRC);
    await mockMailboxSrc.waitForDeployment();

    // Deploy USN contracts
    const USN = await ethers.getContractFactory('USNUpgradeableHyperlane');
    usnSrc = await USN.deploy(await endpointV2MockSrc.getAddress());
    await usnSrc.waitForDeployment();

    usnDst = await USN.deploy(await endpointV2MockSrc.getAddress());
    await usnDst.waitForDeployment();

    // Initialize USN contracts
    await usnSrc.initialize('USN', 'USN', owner.address);
    await usnSrc.setAdmin(admin.address);

    await usnDst.initialize('USN', 'USN', owner.address);
    await usnDst.setAdmin(admin.address);

    // Enable permissionless mode on both chains first
    await usnSrc.enablePermissionless();
    await usnDst.enablePermissionless();

    // Configure Hyperlane for both contracts
    await usnSrc.configureHyperlane(await mockMailboxSrc.getAddress());
    await usnDst.configureHyperlane(await mockMailboxSrc.getAddress());

    // Set up remote mailboxes
    await mockMailboxSrc.setRemoteMailbox(
      CHAIN_ID_SRC,
      await mockMailboxSrc.getAddress()
    );
    // Register remote tokens
    await usnSrc.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(await usnDst.getAddress(), 32)
    );
    await usnDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(await usnSrc.getAddress(), 32)
    );

    // Set mock fee
    await mockMailboxSrc.setMockFee(MOCK_FEE);

    // Mint initial tokens to user1
    await usnSrc.connect(admin).mint(user1.address, initialMint);

    return {
      usnSrc,
      usnDst,
      mockMailboxSrc,
      endpointV2MockSrc,
      owner,
      user1,
      user2,
      admin,
    };
  }

  describe('Cross-chain Token Transfers', function () {
    it('should transfer tokens from source to destination chain', async function () {
      const { usnSrc, usnDst, mockMailboxSrc, user1, user2 } =
        await loadFixture(deployFixture);

      // Get initial balances
      const initialSrcBalance = await usnSrc.balanceOf(user1.address);
      const initialDstBalance = await usnDst.balanceOf(user2.address);

      // Send tokens from source chain
      const fee = await mockMailboxSrc.mockFee();
      await usnSrc
        .connect(user1)
        .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, transferAmount, {
          value: fee,
        });

      // Verify source chain state
      expect(await usnSrc.balanceOf(user1.address)).to.equal(
        initialSrcBalance - transferAmount
      );

      // Verify destination chain state
      expect(await usnDst.balanceOf(user2.address)).to.equal(
        initialDstBalance + transferAmount
      );
    });

    it('should respect blacklist during cross-chain transfers', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      // Blacklist sender
      await usnSrc.blacklistAccount(user1.address);

      // Attempt transfer
      const fee = await mockMailboxSrc.mockFee();
      await expect(
        usnSrc
          .connect(user1)
          .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, transferAmount, {
            value: fee,
          })
      ).to.be.revertedWithCustomError(usnSrc, 'BlacklistedAddress');
    });

    it('should prevent sending tokens to blacklisted address via Hyperlane', async function () {
      const { usnSrc, usnDst, user1, user2 } = await loadFixture(deployFixture);

      // Blacklist recipient on both chains
      await usnSrc.blacklistAccount(user2.address);
      await usnDst.blacklistAccount(user2.address);

      // Attempt transfer to blacklisted address
      const fee = await mockMailboxSrc.mockFee();
      await expect(
        usnSrc
          .connect(user1)
          .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, transferAmount, {
            value: fee,
          })
      ).to.be.revertedWithCustomError(usnSrc, 'BlacklistedAddress');

      // Verify sender's balance remains unchanged
      expect(await usnSrc.balanceOf(user1.address)).to.equal(initialMint);
    });

    it('should work in permissionless mode', async function () {
      const { usnSrc, usnDst, mockMailboxSrc, user1, user2 } =
        await loadFixture(deployFixture);

      // Enable permissionless mode on both chains
      await usnSrc.enablePermissionless();
      await usnDst.enablePermissionless();

      // Get initial balances
      const initialSrcBalance = await usnSrc.balanceOf(user1.address);
      const initialDstBalance = await usnDst.balanceOf(user2.address);

      // Send tokens
      const fee = await mockMailboxSrc.mockFee();
      await usnSrc
        .connect(user1)
        .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, transferAmount, {
          value: fee,
        });

      // Verify source chain state
      expect(await usnSrc.balanceOf(user1.address)).to.equal(
        initialSrcBalance - transferAmount
      );

      // Verify destination chain state
      expect(await usnDst.balanceOf(user2.address)).to.equal(
        initialDstBalance + transferAmount
      );
    });
  });

  describe('Admin Functions', function () {
    it('should allow admin to mint tokens', async function () {
      const { usnSrc, admin, user1 } = await loadFixture(deployFixture);
      const mintAmount = ethers.parseEther('1000');

      await usnSrc.connect(admin).mint(user1.address, mintAmount);
      expect(await usnSrc.balanceOf(user1.address)).to.equal(
        initialMint + mintAmount
      );
    });

    it('should not allow non-admin to mint tokens', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);
      const mintAmount = ethers.parseEther('1000');

      await expect(
        usnSrc.connect(user1).mint(user2.address, mintAmount)
      ).to.be.revertedWithCustomError(usnSrc, 'OnlyAdminCanMint');
    });

    it('should allow owner to set new admin', async function () {
      const { usnSrc, owner, user1 } = await loadFixture(deployFixture);

      await usnSrc.connect(owner).setAdmin(user1.address);
      expect(await usnSrc.admin()).to.equal(user1.address);
    });

    it('should not allow non-owner to set admin', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      await expect(
        usnSrc.connect(user1).setAdmin(user2.address)
      ).to.be.revertedWithCustomError(usnSrc, 'OwnableUnauthorizedAccount');
    });

    it('should not allow setting zero address as admin', async function () {
      const { usnSrc, owner } = await loadFixture(deployFixture);

      await expect(
        usnSrc.connect(owner).setAdmin(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(usnSrc, 'ZeroAddress');
    });
  });

  describe('Blacklist Functions', function () {
    it('should allow owner to blacklist and unblacklist accounts', async function () {
      const { usnSrc, owner, user1 } = await loadFixture(deployFixture);

      await usnSrc.connect(owner).blacklistAccount(user1.address);
      expect(await usnSrc.blacklist(user1.address)).to.be.true;

      await usnSrc.connect(owner).unblacklistAccount(user1.address);
      expect(await usnSrc.blacklist(user1.address)).to.be.false;
    });

    it('should not allow non-owner to blacklist accounts', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      await expect(
        usnSrc.connect(user1).blacklistAccount(user2.address)
      ).to.be.revertedWithCustomError(usnSrc, 'OwnableUnauthorizedAccount');
    });

    it('should prevent blacklisted accounts from receiving tokens', async function () {
      const { usnSrc, owner, user1, user2 } = await loadFixture(deployFixture);

      await usnSrc.connect(owner).blacklistAccount(user2.address);

      await expect(
        usnSrc.connect(user1).transfer(user2.address, transferAmount)
      ).to.be.revertedWithCustomError(usnSrc, 'BlacklistedAddress');
    });

    it('should prevent blacklisted accounts from sending tokens', async function () {
      const { usnSrc, owner, user1, user2 } = await loadFixture(deployFixture);

      await usnSrc.connect(owner).blacklistAccount(user1.address);

      await expect(
        usnSrc.connect(user1).transfer(user2.address, transferAmount)
      ).to.be.revertedWithCustomError(usnSrc, 'BlacklistedAddress');
    });
  });

  describe('Whitelist Functions', function () {
    it('should allow owner to add and remove addresses from whitelist', async function () {
      const { usnSrc, owner, user1 } = await loadFixture(deployFixture);

      await usnSrc.connect(owner).addToWhitelist(user1.address);
      expect(await usnSrc.isWhitelisted(user1.address)).to.be.true;

      await usnSrc.connect(owner).removeFromWhitelist(user1.address);
      expect(await usnSrc.isWhitelisted(user1.address)).to.be.false;
    });

    it('should not allow non-owner to modify whitelist', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      await expect(
        usnSrc.connect(user1).addToWhitelist(user2.address)
      ).to.be.revertedWithCustomError(usnSrc, 'OwnableUnauthorizedAccount');

      await expect(
        usnSrc.connect(user1).removeFromWhitelist(user2.address)
      ).to.be.revertedWithCustomError(usnSrc, 'OwnableUnauthorizedAccount');
    });
  });

  describe('Hyperlane Configuration', function () {
    it('should allow owner to configure Hyperlane mailbox', async function () {
      const { usnSrc, owner, mockMailboxSrc } =
        await loadFixture(deployFixture);

      await usnSrc
        .connect(owner)
        .configureHyperlane(await mockMailboxSrc.getAddress());
      expect(await usnSrc.mailbox()).to.equal(
        await mockMailboxSrc.getAddress()
      );
      expect(await usnSrc.hyperlaneEnabled()).to.be.true;
    });

    it('should not allow non-owner to configure Hyperlane', async function () {
      const { usnSrc, user1, mockMailboxSrc } =
        await loadFixture(deployFixture);

      await expect(
        usnSrc
          .connect(user1)
          .configureHyperlane(await mockMailboxSrc.getAddress())
      ).to.be.revertedWithCustomError(usnSrc, 'OwnableUnauthorizedAccount');
    });

    it('should prevent Hyperlane transfers when not configured', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      // Deploy a new contract without Hyperlane configuration
      const USN = await ethers.getContractFactory('USNUpgradeableHyperlane');
      const usnWithoutHyperlane = await USN.deploy(
        await endpointV2MockSrc.getAddress()
      );
      await usnWithoutHyperlane.waitForDeployment();
      await usnWithoutHyperlane.initialize('USN', 'USN', owner.address);
      await usnWithoutHyperlane.setAdmin(admin.address);
      await usnWithoutHyperlane.enablePermissionless();
      await usnWithoutHyperlane.connect(admin).mint(user1.address, initialMint);

      // Try to send tokens via Hyperlane
      await expect(
        usnWithoutHyperlane
          .connect(user1)
          .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, transferAmount, {
            value: MOCK_FEE,
          })
      ).to.be.revertedWithCustomError(
        usnWithoutHyperlane,
        'HyperlaneNotEnabled'
      );
    });

    it('should prevent Hyperlane transfers with insufficient fee', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      await expect(
        usnSrc
          .connect(user1)
          .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, transferAmount, {
            value: 0,
          })
      ).to.be.revertedWithCustomError(usnSrc, 'InsufficientInterchainFee');
    });
  });

  describe('Edge Cases', function () {
    it('should handle zero amount transfers', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);

      await expect(
        usnSrc
          .connect(user1)
          .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, 0, {
            value: MOCK_FEE,
          })
      ).to.be.revertedWithCustomError(usnSrc, 'InvalidAmount');
    });

    it('should handle transfers to zero address', async function () {
      const { usnSrc, user1 } = await loadFixture(deployFixture);

      await expect(
        usnSrc
          .connect(user1)
          .sendTokensViaHyperlane(
            CHAIN_ID_SRC,
            ethers.ZeroAddress,
            transferAmount,
            {
              value: MOCK_FEE,
            }
          )
      ).to.be.revertedWithCustomError(usnSrc, 'InvalidRecipient');
    });

    it('should handle large transfer amounts', async function () {
      const { usnSrc, user1, user2 } = await loadFixture(deployFixture);
      const largeAmount = ethers.parseEther('1000000000'); // 1 billion tokens

      // Mint large amount to user1
      await usnSrc.connect(admin).mint(user1.address, largeAmount);

      await usnSrc
        .connect(user1)
        .sendTokensViaHyperlane(CHAIN_ID_SRC, user2.address, largeAmount, {
          value: MOCK_FEE,
        });

      expect(await usnSrc.balanceOf(user1.address)).to.equal(initialMint);
      expect(await usnDst.balanceOf(user2.address)).to.equal(largeAmount);
    });
  });
});
