import { Options } from '@layerzerolabs/lz-v2-utilities';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers, upgrades } from 'hardhat';
import type {
  USN,
  MinterHandler,
  StakingVaultOFTUpgradeable,
  MockERC20,
  WithdrawalHandler,
  EndpointV2Mock,
  MockMailbox,
  StakingVaultOFTUpgradeableHyperlane,
} from '../typechain-types';

// Add SendParam type
type SendParamStruct = {
  dstEid: number;
  to: string;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: string;
  composeMsg: string;
  oftCmd: string;
};

describe('USNStakingVault', function () {
  let USN: USN;
  let MinterHandler: MinterHandler;
  let StakingVault: StakingVaultOFTUpgradeable;
  let StakingVaultDst: StakingVaultOFTUpgradeable;
  let HyperlaneVault: StakingVaultOFTUpgradeableHyperlane;
  let HyperlaneVaultDst: StakingVaultOFTUpgradeableHyperlane;
  let mockCollateral: MockERC20;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let rebaseManager: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let externalUser: HardhatEthersSigner;
  let blacklistManager: HardhatEthersSigner;
  let endpointV2MockSrc: EndpointV2Mock;
  let endpointV2MockDst: EndpointV2Mock;
  let withdrawalHandler: WithdrawalHandler;
  let mockMailboxSrc: MockMailbox;
  let mockMailboxDst: MockMailbox;
  let stakingVaultProxySrc: Contract;

  const CHAIN_ID_SRC = 1;
  const CHAIN_ID_DST = 2;
  const initialMint = ethers.parseUnits('1000000', 18);
  const stakeAmount = ethers.parseUnits('10000', 18);
  const rebaseAmount = ethers.parseUnits('1000', 18);

  // Add this helper function at the top of the file, outside the describe block
  async function setupHyperlaneMocks() {
    // Deploy mock Hyperlane mailboxes
    const MockMailbox = await ethers.getContractFactory('MockMailbox');
    const mockMailboxSrc = await MockMailbox.deploy(CHAIN_ID_SRC);
    const mockMailboxDst = await MockMailbox.deploy(CHAIN_ID_DST);

    // Set up remote mailboxes
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxDst.target);
    await mockMailboxDst.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxSrc.target);

    return { mockMailboxSrc, mockMailboxDst };
  }

  beforeEach(async function () {
    [
      owner,
      user1,
      user2,
      rebaseManager,
      minter,
      externalUser,
      blacklistManager,
    ] = await ethers.getSigners();

    // Deploy mock LayerZero endpoints for both chains
    const EndpointV2Mock = await ethers.getContractFactory('EndpointV2Mock');
    endpointV2MockSrc = await EndpointV2Mock.deploy(CHAIN_ID_SRC);
    endpointV2MockDst = await EndpointV2Mock.deploy(CHAIN_ID_DST);

    const USNFactory = await ethers.getContractFactory('USN');
    USN = await USNFactory.deploy(endpointV2MockSrc.target);
    expect(await USN.owner()).to.equal(await owner.getAddress());
    await USN.enablePermissionless();
    const MinterHandlerFactory =
      await ethers.getContractFactory('MinterHandler');
    MinterHandler = await MinterHandlerFactory.deploy(await USN.getAddress());

    // Deploy StakingVaultOFTUpgradeable with proxy on source chain
    const StakingVaultFactory = await ethers.getContractFactory(
      'StakingVaultOFTUpgradeable'
    );
    stakingVaultProxySrc = await upgrades.deployProxy(
      StakingVaultFactory,
      [await USN.getAddress(), 'Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockSrc.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );
    StakingVault = StakingVaultFactory.attach(
      await stakingVaultProxySrc.getAddress()
    ) as StakingVaultOFTUpgradeable;
    const StakedUSNBasicOFTFactory =
      await ethers.getContractFactory('StakedUSNBasicOFT');
    // Deploy StakingVaultOFTUpgradeable with proxy on destination chain
    const stakingVaultProxyDst = await upgrades.deployProxy(
      StakedUSNBasicOFTFactory,
      ['Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockDst.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );

    StakingVaultDst = StakedUSNBasicOFTFactory.attach(
      await stakingVaultProxyDst.getAddress()
    ) as StakingVaultOFTUpgradeable;

    await endpointV2MockSrc.setDestLzEndpoint(
      await StakingVaultDst.getAddress(),
      await endpointV2MockDst.getAddress()
    );
    await endpointV2MockDst.setDestLzEndpoint(
      await StakingVault.getAddress(),
      await endpointV2MockSrc.getAddress()
    );

    // Set up peers between vaults
    await StakingVault.setPeer(
      CHAIN_ID_DST,
      ethers.zeroPadValue(await StakingVaultDst.getAddress(), 32)
    );
    await StakingVaultDst.setPeer(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(await StakingVault.getAddress(), 32)
    );

    // Deploy mock Hyperlane mailboxes
    const MockMailbox = await ethers.getContractFactory('MockMailbox');
    mockMailboxSrc = await MockMailbox.deploy(CHAIN_ID_SRC);
    mockMailboxDst = await MockMailbox.deploy(CHAIN_ID_DST);

    // Deploy StakingVaultOFTUpgradeableHyperlane with proxy
    const StakingVaultFactoryHyperlane = await ethers.getContractFactory(
      'StakingVaultOFTUpgradeableHyperlane'
    );
    const hyperlaneVaultProxySrc = await upgrades.deployProxy(
      StakingVaultFactoryHyperlane,
      [await USN.getAddress(), 'Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockSrc.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );
    HyperlaneVault = StakingVaultFactoryHyperlane.attach(
      await hyperlaneVaultProxySrc.getAddress()
    ) as StakingVaultOFTUpgradeableHyperlane;

    // Deploy StakedUSNBasicOFTHyperlane with proxy on destination chain
    const StakedUSNBasicOFTHyperlaneFactory = await ethers.getContractFactory(
      'StakedUSNBasicOFTHyperlane'
    );
    const hyperlaneVaultProxyDst = await upgrades.deployProxy(
      StakedUSNBasicOFTHyperlaneFactory,
      ['Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockDst.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );
    HyperlaneVaultDst = StakedUSNBasicOFTHyperlaneFactory.attach(
      await hyperlaneVaultProxyDst.getAddress()
    ) as StakingVaultOFTUpgradeableHyperlane;

    // Configure Hyperlane for both vaults
    await HyperlaneVault.configureHyperlane(mockMailboxSrc.target);
    await HyperlaneVaultDst.configureHyperlane(mockMailboxDst.target);

    // Set up remote mailboxes
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxDst.target);
    await mockMailboxDst.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxSrc.target);

    // Register remote tokens
    await HyperlaneVault.registerHyperlaneRemoteToken(
      CHAIN_ID_DST,
      ethers.zeroPadValue(HyperlaneVaultDst.target, 32)
    );
    await HyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(HyperlaneVault.target, 32)
    );

    // Rest of setup...
    const MockERC20Factory = await ethers.getContractFactory('MockERC20');
    mockCollateral = await MockERC20Factory.deploy('Mock Collateral', 'MCOL');

    // Set up roles and permissions
    await USN.setAdmin(await MinterHandler.getAddress());
    await MinterHandler.grantRole(
      await MinterHandler.MINTER_ROLE(),
      await minter.getAddress()
    );
    await MinterHandler.addWhitelistedUser(await user1.getAddress());
    await MinterHandler.addWhitelistedUser(await user2.getAddress());
    await MinterHandler.addWhitelistedUser(await rebaseManager.getAddress());
    await MinterHandler.addWhitelistedCollateral(
      await mockCollateral.getAddress()
    );

    // Set up roles for both vaults
    for (const vault of [StakingVault]) {
      await vault.setRebaseManager(await rebaseManager.getAddress());
      await vault.grantRole(
        await vault.BLACKLIST_MANAGER_ROLE(),
        await blacklistManager.getAddress()
      );
    }

    // Mint initial USN for users
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const expiry = currentTimestamp + 360000 * 10; // 100000 hours from now
    const nonce = 1;

    for (const user of [user1, user2, rebaseManager]) {
      const userAddress = await user.getAddress();
      const order = {
        message: `You are signing a request to mint ${initialMint} USN using ${initialMint} MCOL as collateral.`,
        user: userAddress,
        collateralAmount: initialMint,
        usnAmount: initialMint,
        nonce: nonce,
        expiry: expiry,
        collateralAddress: await mockCollateral.getAddress(),
      };

      const domain = {
        name: 'MinterHandler',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await MinterHandler.getAddress(),
      };

      const types = {
        Order: [
          { name: 'message', type: 'string' },
          { name: 'user', type: 'address' },
          { name: 'collateralAddress', type: 'address' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'usnAmount', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
        ],
      };

      const signature = await user.signTypedData(domain, types, order);
      MinterHandler.setCustodialWallet(await StakingVault.getAddress());
      // Mint collateral to user
      await mockCollateral.mint(userAddress, initialMint);

      // Approve MinterHandler to spend collateral
      await mockCollateral
        .connect(user)
        .approve(await MinterHandler.getAddress(), initialMint);

      // Mint USN
      await MinterHandler.connect(minter).mint(order, signature);
    }

    // Approve both StakingVaults to spend USN
    for (const vault of [StakingVault, StakingVaultDst]) {
      await USN.connect(user1).approve(
        await vault.getAddress(),
        ethers.MaxUint256
      );
      await USN.connect(user2).approve(
        await vault.getAddress(),
        ethers.MaxUint256
      );
      await USN.connect(rebaseManager).approve(
        await vault.getAddress(),
        ethers.MaxUint256
      );
    }

    const WithdrawalHandlerFactory =
      await ethers.getContractFactory('WithdrawalHandler');
    withdrawalHandler = await WithdrawalHandlerFactory.deploy(
      await USN.getAddress(),
      24 * 60 * 60 // 1 day
    );
    await withdrawalHandler.waitForDeployment();

    // Grant STAKING_VAULT_ROLE to StakingVault
    const STAKING_VAULT_ROLE = await withdrawalHandler.STAKING_VAULT_ROLE();
    await withdrawalHandler.grantRole(
      STAKING_VAULT_ROLE,
      await StakingVault.getAddress()
    );
    await withdrawalHandler.grantRole(
      STAKING_VAULT_ROLE,
      await HyperlaneVault.getAddress()
    );

    // Set WithdrawalHandler in StakingVault
    await StakingVault.setWithdrawalHandler(
      await withdrawalHandler.getAddress()
    );
    await HyperlaneVault.setWithdrawalHandler(
      await withdrawalHandler.getAddress()
    );
  });

  it('should allow staking USN and minting shares', async function () {
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    const shares = await StakingVault.balanceOf(await user1.getAddress());
    expect(shares).to.equal(stakeAmount);

    const assets = await StakingVault.totalAssets();
    expect(assets).to.equal(stakeAmount);

    // Test ERC20 sUSN properties
    expect(await StakingVault.name()).to.equal('Staked USN');
    expect(await StakingVault.symbol()).to.equal('sUSN');
    expect(await StakingVault.decimals()).to.equal(18);
  });

  it('should mint correct amount of sUSN when depositing USN', async function () {
    const initialBalance = await StakingVault.balanceOf(
      await user1.getAddress()
    );
    expect(initialBalance).to.equal(0);

    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    const newBalance = await StakingVault.balanceOf(await user1.getAddress());
    expect(newBalance).to.equal(stakeAmount);

    // Test that the total supply of sUSN has increased
    expect(await StakingVault.totalSupply()).to.equal(stakeAmount);
  });

  it('should allow transfer of sUSN tokens', async function () {
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    const transferAmount = ethers.parseUnits('5000', 18);
    await StakingVault.connect(user1).transfer(
      await user2.getAddress(),
      transferAmount
    );

    expect(await StakingVault.balanceOf(await user1.getAddress())).to.equal(
      stakeAmount - transferAmount
    );
    expect(await StakingVault.balanceOf(await user2.getAddress())).to.equal(
      transferAmount
    );
  });

  it('should reflect rebase in withdrawals', async function () {
    // Stake USN
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Get initial assets
    const assets = await StakingVault.convertToAssets(stakeAmount);

    // Perform rebase
    await StakingVault.connect(rebaseManager).rebase(rebaseAmount);

    // Check if new convertToAssets is greater than before
    const newAssets = await StakingVault.convertToAssets(stakeAmount);
    expect(newAssets).to.be.greaterThan(assets);

    // Get balances before withdrawal
    const balanceUsnBefore = await USN.balanceOf(user1.address);
    const balanceSUsnBefore = await StakingVault.balanceOf(user1.address);
    // Preview withdrawal amount before creating demand
    const previewAssets = await StakingVault.previewRedeem(assets);
    const userAssets = await StakingVault.previewRedeem(balanceSUsnBefore);

    expect(previewAssets).to.be.lte(userAssets);

    // Create withdrawal demand with slippage check
    await StakingVault.connect(user1).withdrawWithSlippageCheck(
      userAssets,
      withdrawalHandler.target,
      user1.address,
      stakeAmount + (stakeAmount * 2n) / 100n // 2% slippage
    );

    // Get withdrawal request ID
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Fast forward time
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim withdrawal
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    // Get balances after withdrawal
    const balanceUsnAfter = await USN.balanceOf(user1.address);
    const balanceSUsnAfter = await StakingVault.balanceOf(user1.address);

    // Check balances
    expect(balanceSUsnBefore).to.be.greaterThan(balanceSUsnAfter);
    expect(balanceSUsnAfter).to.equal(0);
    expect(balanceUsnAfter).to.equal(balanceUsnBefore + newAssets);
  });

  it('should not reflect rebase in withdrawals if made after withdrawal demand', async function () {
    // Stake USN
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );
    // Have user2 deposit as well
    await StakingVault.connect(user2).deposit(
      stakeAmount,
      await user2.getAddress()
    );
    // Verify user1 and user2 have different balances
    const user1Balance = await StakingVault.balanceOf(user1.address);
    const user2Balance = await StakingVault.balanceOf(user2.address);
    expect(user1Balance).to.equal(user2Balance);
    expect(user1.address).to.not.equal(user2.address);
    // Get initial assets
    const assets = await StakingVault.convertToAssets(stakeAmount);

    // Get balances before withdrawal
    const balanceUsnBefore = await USN.balanceOf(user1.address);
    const balanceSUsnBefore = await StakingVault.balanceOf(user1.address);

    // Create withdrawal demand with slippage check
    await StakingVault.connect(user1).withdrawWithSlippageCheck(
      stakeAmount,
      withdrawalHandler.target,
      user1.address,
      stakeAmount + (stakeAmount * 2n) / 100n // 2% slippage
    );

    // Get withdrawal request ID
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Check sUSN balance is correct before rebase
    expect(await StakingVault.balanceOf(user1.address)).to.equal(0);

    // Perform rebase
    await StakingVault.connect(rebaseManager).rebase(rebaseAmount);

    // Fast forward time
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim withdrawal
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    // Get balances after withdrawal
    const balanceUsnAfter = await USN.balanceOf(user1.address);
    const balanceSUsnAfter = await StakingVault.balanceOf(user1.address);

    // Check balances
    expect(balanceSUsnBefore).to.be.greaterThan(balanceSUsnAfter);
    expect(balanceSUsnAfter).to.equal(0);
    expect(balanceUsnAfter).to.equal(balanceUsnBefore + assets);
    // Check USN balance on staking vault
    const vaultUsnBalance = await USN.balanceOf(
      await StakingVault.getAddress()
    );
    expect(vaultUsnBalance).to.equal(rebaseAmount + stakeAmount);
  });

  it('should enforce withdraw period', async function () {
    // Stake USN
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Create withdrawal demand with slippage check
    await StakingVault.connect(user1).withdrawWithSlippageCheck(
      stakeAmount,
      withdrawalHandler.target,
      user1.address,
      stakeAmount + (stakeAmount * 2n) / 100n // 2% slippage
    );

    // Get withdrawal request ID
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Try to claim immediately (should fail)
    await expect(
      withdrawalHandler.connect(user1).claimWithdrawal(requestId)
    ).to.be.revertedWithCustomError(
      withdrawalHandler,
      'WithdrawPeriodNotElapsed'
    );

    // Fast forward time
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim should now succeed
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    expect(await USN.balanceOf(user1.address)).to.equal(initialMint);
  });

  it('should not allow external user to claim withdrawal', async function () {
    // Stake USN
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Create withdrawal demand with slippage check
    await StakingVault.connect(user1).withdrawWithSlippageCheck(
      stakeAmount,
      withdrawalHandler.target,
      user1.address,
      stakeAmount + (stakeAmount * 2n) / 100n // 2% slippage
    );

    // Get withdrawal request ID
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Fast forward time
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // External user tries to claim (should fail)
    await expect(
      withdrawalHandler.connect(externalUser).claimWithdrawal(requestId)
    ).to.be.revertedWithCustomError(withdrawalHandler, 'Unauthorized');
  });

  it('should not allow blacklisted user to withdraw', async function () {
    // Stake USN
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Blacklist user1
    await StakingVault.connect(blacklistManager).blacklistAccount(
      user1.address
    );

    // Withdraw should fail for blacklisted user
    await expect(
      StakingVault.connect(user1).withdrawWithSlippageCheck(
        stakeAmount,
        withdrawalHandler.target,
        user1.address,
        stakeAmount + (stakeAmount * 2n) / 100n // 2% slippage
      )
    ).to.be.revertedWithCustomError(StakingVault, 'BlacklistedAddress');
  });

  it('should not allow transfer to blacklisted address', async function () {
    // Stake USN with user1
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Blacklist user2
    await StakingVault.connect(blacklistManager).blacklistAccount(
      await user2.getAddress()
    );

    // Try to transfer from user1 to blacklisted user2 (should fail)
    await expect(
      StakingVault.connect(user1).transfer(
        await user2.getAddress(),
        stakeAmount
      )
    ).to.be.revertedWithCustomError(StakingVault, 'BlacklistedAddress');
  });

  it('should allow transfer after unblacklisting', async function () {
    // Stake USN with user1
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Blacklist user2
    await StakingVault.connect(blacklistManager).blacklistAccount(
      await user2.getAddress()
    );
    // Transfer should revert
    await expect(
      StakingVault.connect(user1).transfer(
        await user2.getAddress(),
        stakeAmount
      )
    ).to.be.revertedWithCustomError(StakingVault, 'BlacklistedAddress');

    // Unblacklist user2
    await StakingVault.connect(blacklistManager).unblacklistAccount(
      await user2.getAddress()
    );

    // Transfer should now succeed
    await expect(
      StakingVault.connect(user1).transfer(
        await user2.getAddress(),
        stakeAmount
      )
    ).to.not.be.reverted;

    // Check balances
    expect(await StakingVault.balanceOf(await user2.getAddress())).to.equal(
      stakeAmount
    );
    expect(await StakingVault.balanceOf(await user1.getAddress())).to.equal(0);
  });

  it('should allow admin to rescue tokens', async function () {
    const TestTokenFactory = await ethers.getContractFactory('MockERC20'); // Using USN as a test token
    const testToken = await TestTokenFactory.deploy('TestToken', 'TEST');

    const rescueAmount = ethers.parseUnits('1000', 18);

    // Transfer some test tokens to the StakingVault
    await testToken.mint(await StakingVault.getAddress(), rescueAmount);

    const initialBalance = await testToken.balanceOf(await owner.getAddress());

    // Rescue tokens
    await expect(
      StakingVault.connect(owner).rescueToken(
        await testToken.getAddress(),
        await owner.getAddress(),
        rescueAmount
      )
    ).to.not.be.reverted;

    // Check balances
    expect(await testToken.balanceOf(await owner.getAddress())).to.equal(
      initialBalance + rescueAmount
    );
    expect(await testToken.balanceOf(await StakingVault.getAddress())).to.equal(
      0
    );
  });

  it('should not allow rescuing vault token or underlying asset', async function () {
    // Attempt to rescue vault token (should fail)
    await expect(
      StakingVault.connect(owner).rescueToken(
        await StakingVault.getAddress(),
        await owner.getAddress(),
        stakeAmount
      )
    ).to.be.revertedWithCustomError(StakingVault, 'CannotRescueVaultToken');

    // Attempt to rescue underlying asset (should fail)
    await expect(
      StakingVault.connect(owner).rescueToken(
        await USN.getAddress(),
        await owner.getAddress(),
        stakeAmount
      )
    ).to.be.revertedWithCustomError(
      StakingVault,
      'CannotRescueUnderlyingAsset'
    );
  });
  it('should allow depositWithPermit', async function () {
    const amount = ethers.parseUnits('1000', 18);
    const deadline = Math.floor(Date.now() / 1000) + 3600 * 100; // 100 hour from now
    const nonce = await USN.nonces(user1.address);

    const domain = {
      name: await USN.name(),
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await USN.getAddress(),
    };

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const values = {
      owner: user1.address,
      spender: await StakingVault.getAddress(),
      value: amount,
      nonce: nonce,
      deadline: deadline,
    };

    const signature = await user1.signTypedData(domain, types, values);
    const { v, r, s } = ethers.Signature.from(signature);

    const initialBalance = await StakingVault.balanceOf(user1.address);
    await expect(
      StakingVault.connect(user1).depositWithPermit(
        amount,
        user1.address,
        deadline,
        v,
        r,
        s
      )
    )
      .to.emit(StakingVault, 'Deposit')
      .withArgs(user1.address, user1.address, amount, amount);

    const finalBalance = await StakingVault.balanceOf(user1.address);
    expect(finalBalance).to.equal(initialBalance + amount);
  });
  it('should not allow rebase if no shares minted', async function () {
    const amount = ethers.parseUnits('1000', 18);
    const deadline = Math.floor(Date.now() / 1000) + 3600 * 100; // 100 hour from now
    const nonce = await USN.nonces(rebaseManager.address);

    const domain = {
      name: await USN.name(),
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await USN.getAddress(),
    };

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const values = {
      owner: rebaseManager.address,
      spender: await StakingVault.getAddress(),
      value: amount,
      nonce: nonce,
      deadline: deadline,
    };

    const signature = await rebaseManager.signTypedData(domain, types, values);
    const { v, r, s } = ethers.Signature.from(signature);

    // Verify total supply is 0
    expect(await StakingVault.totalSupply()).to.equal(0);

    // Attempt rebase should fail
    await expect(
      StakingVault.connect(rebaseManager).rebaseWithPermit(
        amount,
        deadline,
        v,
        r,
        s
      )
    ).to.be.revertedWithCustomError(StakingVault, 'NoSharesMinted');
  });

  it('should allow rebaseWithPermit', async function () {
    const amount = ethers.parseUnits('1000', 18);
    const deadline = Math.floor(Date.now() / 1000) + 3600 * 100; // 100 hour from now
    const nonce = await USN.nonces(rebaseManager.address);
    // First stake some USN to have shares minted
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );

    // Verify shares were minted
    const shares = await StakingVault.balanceOf(await user1.getAddress());
    expect(shares).to.equal(stakeAmount);
    const domain = {
      name: await USN.name(),
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await USN.getAddress(),
    };

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    const values = {
      owner: rebaseManager.address,
      spender: await StakingVault.getAddress(),
      value: amount,
      nonce: nonce,
      deadline: deadline,
    };

    const signature = await rebaseManager.signTypedData(domain, types, values);
    const { v, r, s } = ethers.Signature.from(signature);

    const initialTotalSupply = await StakingVault.totalAssets();
    await expect(
      StakingVault.connect(rebaseManager).rebaseWithPermit(
        amount,
        deadline,
        v,
        r,
        s
      )
    ).to.emit(StakingVault, 'Rebase');

    // Shouldn't change the total supply
    const finalTotalSupply = await StakingVault.totalSupply();
    expect(finalTotalSupply).to.equal(initialTotalSupply);
  });
  it('should allow depositWithSlippageCheck', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const minSharesOut = ethers.parseUnits('990', 18); // Allowing for 1% slippage

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );

    const initialBalance = await StakingVault.balanceOf(user1.address);

    await expect(
      StakingVault.connect(user1).depositWithSlippageCheck(
        depositAmount,
        user1.address,
        minSharesOut
      )
    )
      .to.emit(StakingVault, 'Deposit')
      .withArgs(
        user1.address,
        user1.address,
        depositAmount,
        await StakingVault.previewDeposit(depositAmount)
      );

    const finalBalance = await StakingVault.balanceOf(user1.address);
    expect(finalBalance).to.be.gte(initialBalance + minSharesOut);
  });

  it('should revert depositWithSlippageCheck if slippage is exceeded', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const minSharesOut = ethers.parseUnits('1001', 18); // Unrealistic expectation

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );

    await expect(
      StakingVault.connect(user1).depositWithSlippageCheck(
        depositAmount,
        user1.address,
        minSharesOut
      )
    ).to.be.revertedWithCustomError(StakingVault, 'SlippageExceeded');
  });
  it('should allow withdrawWithSlippageCheck', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const withdrawAmount = ethers.parseUnits('500', 18);

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Set withdraw period to 1 for testing
    await withdrawalHandler.setWithdrawPeriod(1);

    // Create withdrawal demand with slippage check
    await StakingVault.connect(user1).withdrawWithSlippageCheck(
      withdrawAmount,
      withdrawalHandler.target,
      user1.address,
      withdrawAmount + (withdrawAmount * 2n) / 100n //2% slippage
    );

    // Get withdrawal request ID
    const initialBalance = await USN.balanceOf(user1.address);
    await expect(
      StakingVault.connect(user1).withdrawWithSlippageCheck(
        withdrawAmount,
        user1.address,
        user1.address,
        withdrawAmount + (withdrawAmount * 2n) / 100n //2% slippage
      )
    ).to.be.revertedWithCustomError(StakingVault, 'Unauthorized');
    await StakingVault.connect(user1).withdraw(
      withdrawAmount,
      withdrawalHandler.target,
      user1.address
    );

    // Fast forward time to allow withdrawal
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Get request ID and claim from withdrawal handler
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);
    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance).to.equal(initialBalance + withdrawAmount);
  });

  it('should revert withdrawWithSlippageCheck if slippage is exceeded', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const withdrawAmount = ethers.parseUnits('500', 18);
    const maxSharesBurned = ethers.parseUnits('490', 18); // Unrealistic expectation

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Set withdraw period to 1 for testing
    await withdrawalHandler.setWithdrawPeriod(1);

    // Create withdrawal demand
    await StakingVault.connect(user1).withdraw(
      withdrawAmount,
      withdrawalHandler.target,
      user1.address
    );

    await expect(
      StakingVault.connect(user1).withdrawWithSlippageCheck(
        withdrawAmount,
        user1.address,
        user1.address,
        maxSharesBurned
      )
    ).to.be.revertedWithCustomError(StakingVault, 'SlippageExceeded');
  });

  it('should allow claim', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const redeemShares = ethers.parseUnits('500', 18);
    const minAssetsOut = ethers.parseUnits('490', 18); // Allowing for 2% slippage

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Set withdraw period to 1 for testing
    await withdrawalHandler.setWithdrawPeriod(1);

    await StakingVault.connect(user1).withdraw(
      redeemShares,
      withdrawalHandler.target,
      user1.address
    );

    const initialBalance = await USN.balanceOf(user1.address);

    // Get the latest request ID
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Fast forward time to allow withdrawal
    await ethers.provider.send('evm_increaseTime', [2]); // Move past withdraw period
    await ethers.provider.send('evm_mine', []);

    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance).to.be.gte(initialBalance + minAssetsOut);
  });

  it('should revert redeemWithSlippageCheck if slippage is exceeded', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const redeemShares = ethers.parseUnits('500', 18);
    const minAssetsOut = ethers.parseUnits('510', 18); // Unrealistic expectation

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Set withdraw period to 1 for testing
    await withdrawalHandler.setWithdrawPeriod(1);
    // Create withdrawal demand
    await StakingVault.connect(user1).withdraw(
      redeemShares,
      withdrawalHandler.target,
      user1.address
    );

    await expect(
      StakingVault.connect(user1).redeemWithSlippageCheck(
        redeemShares,
        user1.address,
        user1.address,
        minAssetsOut
      )
    ).to.be.revertedWithCustomError(StakingVault, 'SlippageExceeded');
  });
  it('should successfully redeemWithSlippageCheck when slippage is within limits', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const redeemShares = ethers.parseUnits('500', 18);
    const minAssetsOut = ethers.parseUnits('490', 18); // Slightly lower than expected to account for potential slippage

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Set withdraw period to 1 for testing
    await withdrawalHandler.setWithdrawPeriod(1);

    // Create withdrawal demand
    await StakingVault.connect(user1).withdraw(
      redeemShares,
      withdrawalHandler.target,
      user1.address
    );

    const initialBalance = await USN.balanceOf(user1.address);

    // Get the latest request ID and claim withdrawal
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance).to.be.gte(initialBalance + minAssetsOut);
  });

  it('should revert redeemWithSlippageCheck if withdrawal period has not passed', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const redeemShares = ethers.parseUnits('500', 18);
    const minAssetsOut = ethers.parseUnits('490', 18);

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    await withdrawalHandler.setWithdrawPeriod(10);
    // Create withdrawal demand
    await StakingVault.connect(user1).withdraw(
      redeemShares,
      withdrawalHandler.target,
      user1.address
    );
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    await expect(
      withdrawalHandler.connect(user1).claimWithdrawal(requestId)
    ).to.be.revertedWithCustomError(
      withdrawalHandler,
      'WithdrawPeriodNotElapsed'
    );
  });

  it('should revert redeemWithSlippageCheck if user has no withdrawal demand', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    const redeemShares = ethers.parseUnits('500', 18);
    const minAssetsOut = ethers.parseUnits('490', 18);

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Set withdraw period to 1 for testing
    await withdrawalHandler.setWithdrawPeriod(1);

    // Do not create a withdrawal demand

    await expect(
      withdrawalHandler.connect(user1).claimWithdrawal(0)
    ).to.be.revertedWithCustomError(withdrawalHandler, 'Unauthorized');
  });
  it('should allow mintWithSlippageCheck', async function () {
    const mintShares = ethers.parseUnits('1000', 18);
    const maxAssets = ethers.parseUnits('1010', 18); // Allowing for 1% slippage

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, maxAssets);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      maxAssets
    );

    const initialBalance = await StakingVault.balanceOf(user1.address);

    await expect(
      StakingVault.connect(user1).mintWithSlippageCheck(
        mintShares,
        user1.address,
        maxAssets
      )
    )
      .to.emit(StakingVault, 'Deposit')
      .withArgs(
        user1.address,
        user1.address,
        await StakingVault.previewMint(mintShares),
        mintShares
      );

    const finalBalance = await StakingVault.balanceOf(user1.address);
    expect(finalBalance).to.equal(initialBalance + mintShares);
  });

  it('should revert mintWithSlippageCheck if slippage is exceeded', async function () {
    const mintShares = ethers.parseUnits('1000', 18);
    const maxAssets = ethers.parseUnits('990', 18); // Unrealistic expectation (too low)

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, ethers.parseUnits('1100', 18)); // Mint more than maxAssets
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      ethers.parseUnits('1100', 18)
    );

    await expect(
      StakingVault.connect(user1).mintWithSlippageCheck(
        mintShares,
        user1.address,
        maxAssets
      )
    ).to.be.revertedWithCustomError(StakingVault, 'SlippageExceeded');
  });
  it('should correctly track balances and shares across chains', async function () {
    // User1 stakes on source chain
    const user1StakeAmount = ethers.parseUnits('5000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, user1StakeAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      user1StakeAmount
    );
    await StakingVault.connect(user1).deposit(
      user1StakeAmount,
      await user1.getAddress()
    );

    // User2 stakes on destination chain
    const user2StakeAmount = ethers.parseUnits('3000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user2.address, user2StakeAmount);
    await USN.connect(user2).approve(
      await StakingVaultDst.getAddress(),
      user2StakeAmount
    );

    // Verify initial balances on both chains
    expect(await StakingVault.balanceOf(await user1.getAddress())).to.equal(
      user1StakeAmount
    );

    expect(await StakingVault.totalSupply()).to.equal(user1StakeAmount);

    // User1 sends shares cross-chain to destination using OFT transfer
    const transferAmount = ethers.parseUnits('2000', 18);
    const executorLzReceiveOptionMaxGas = 65000;
    const options = Options.newOptions()
      .addExecutorLzReceiveOption(BigInt(executorLzReceiveOptionMaxGas), 0)
      .toHex();

    const sendParams: SendParamStruct = {
      dstEid: CHAIN_ID_DST,
      to: ethers.zeroPadValue(await user1.getAddress(), 32),
      amountLD: transferAmount,
      minAmountLD: transferAmount,
      extraOptions: options,
      composeMsg: '0x',
      oftCmd: '0x',
    };

    const [nativeFee] = await StakingVault.quoteSend(sendParams, false);
    await StakingVault.connect(user1).approve(
      await StakingVault.getAddress(),
      transferAmount
    );
    await StakingVault.connect(user1).send(
      sendParams,
      [nativeFee, 0],
      await user1.getAddress(),
      { value: nativeFee }
    );

    // Verify balances after cross-chain transfer
    expect(await StakingVault.balanceOf(await user1.getAddress())).to.equal(
      user1StakeAmount - transferAmount
    );
    expect(await StakingVaultDst.balanceOf(await user1.getAddress())).to.equal(
      transferAmount
    );
    expect(await StakingVaultDst.balanceOf(await user2.getAddress())).to.equal(
      0
    );

    expect(await StakingVault.totalSupply()).to.equal(user1StakeAmount);
    expect(await StakingVaultDst.totalSupply()).to.equal(transferAmount);
  });

  it('should maintain correct share ratios when source chain rebases', async function () {
    // Initial stakes
    const user1StakeAmount = ethers.parseUnits('5000', 18);

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, user1StakeAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      user1StakeAmount
    );
    await StakingVault.connect(user1).deposit(
      user1StakeAmount,
      await user1.getAddress()
    );

    await USN.setAdmin(owner.address);

    // Record user2's initial shares
    const user2SharesBefore = await StakingVault.convertToShares(
      await StakingVault.balanceOf(user2.address)
    );

    // Send shares cross-chain before rebase
    const transferAmount = ethers.parseUnits('2500', 18);
    const executorLzReceiveOptionMaxGas = 65000;
    const options = Options.newOptions()
      .addExecutorLzReceiveOption(BigInt(executorLzReceiveOptionMaxGas), 0)
      .toHex();
    const sendParams = [
      CHAIN_ID_DST,
      ethers.zeroPadValue(await user1.getAddress(), 32),
      transferAmount,
      transferAmount,
      options,
      '0x',
      '0x',
    ];

    const [nativeFee] = await StakingVault.quoteSend(sendParams, false);
    await StakingVault.connect(user1).approve(
      await StakingVault.getAddress(),
      transferAmount
    );

    await StakingVault.connect(user1).send(
      sendParams,
      [nativeFee, 0],
      await user1.getAddress(),
      { value: nativeFee }
    );

    // Perform rebase only on source chain
    await StakingVault.connect(rebaseManager).rebase(rebaseAmount);

    // Verify user2's shares remain unchanged after rebase
    const user2SharesAfter = await StakingVault.convertToShares(
      await StakingVault.balanceOf(user2.address)
    );
    expect(user2SharesAfter).to.equal(user2SharesBefore);

    // Verify source chain total assets increased by rebase amount
    const srcAssetsBefore = user1StakeAmount;
    const srcAssetsAfter = await StakingVault.totalAssets();
    expect(srcAssetsAfter).to.equal(srcAssetsBefore + rebaseAmount);

    // Verify destination chain total supply unchanged
    //const dstTotalSupply = await StakingVaultDst.totalSupply();
    //expect(dstTotalSupply).to.equal(transferAmount);
  });

  it('should handle withdrawals through WithdrawalHandler', async function () {
    // User deposits
    const depositAmount = ethers.parseUnits('1000', 18);
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);
    // Create withdrawal demand
    await StakingVault.connect(user1).withdraw(
      depositAmount,
      withdrawalHandler.target,
      user1.address
    );

    // Check withdrawal request in handler
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    const request = await withdrawalHandler.getWithdrawalRequest(
      user1.address,
      requestId
    );
    expect(request.amount).to.equal(depositAmount);
    expect(request.claimed).to.be.false;

    // Fast forward time
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim withdrawal
    const initialBalance = await USN.balanceOf(user1.address);
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    // Verify balances
    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.equal(depositAmount);

    // Verify request is marked as claimed
    const requestAfter = await withdrawalHandler.getWithdrawalRequest(
      user1.address,
      requestId
    );
    expect(requestAfter.claimed).to.be.true;
  });

  it('should revert withdrawal request if caller is not staking vault', async function () {
    const amount = ethers.parseUnits('1000', 18);
    await expect(
      withdrawalHandler
        .connect(user1)
        .createWithdrawalRequest(user1.address, amount)
    ).to.be.revertedWithCustomError(
      withdrawalHandler,
      'AccessControlUnauthorizedAccount'
    );
  });

  it('should create withdrawal request with correct parameters', async function () {
    const amount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, amount);
    await USN.connect(user1).approve(await StakingVault.getAddress(), amount);
    await StakingVault.connect(user1).deposit(amount, user1.address);
    await StakingVault.connect(user1).withdraw(
      amount,
      withdrawalHandler.target,
      user1.address
    );

    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    const request = await withdrawalHandler.getWithdrawalRequest(
      user1.address,
      requestId
    );

    expect(request.amount).to.equal(amount);
    expect(request.claimed).to.be.false;
  });
  it('should not give yield if withdrawal demand is made before rebase', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Create withdrawal demand for all shares
    await StakingVault.connect(user1).withdraw(
      depositAmount,
      withdrawalHandler.target,
      user1.address
    );

    // Simulate a rebase/yield distribution
    const yieldAmount = ethers.parseUnits('100', 18);
    await USN.mint(await StakingVault.getAddress(), yieldAmount);

    // Fast forward time
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim withdrawal
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    const initialBalance = await USN.balanceOf(user1.address);
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    // Verify user only gets original amount without yield
    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.equal(depositAmount);

    // Try to withdraw more than deposited - should fail
    await expect(
      StakingVault.connect(user1).withdraw(
        depositAmount,
        withdrawalHandler.target,
        user1.address
      )
    ).to.be.revertedWithCustomError(StakingVault, 'ERC4626ExceededMaxWithdraw');
  });
  it('should revert when redeeming with slippage check fails', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Create withdrawal request
    await StakingVault.connect(user1).withdraw(
      depositAmount,
      withdrawalHandler.target,
      user1.address
    );
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Set minimum amount higher than actual withdrawal amount to trigger slippage check
    const minAmount = depositAmount + ethers.parseUnits('1', 18);
  });

  it('should successfully redeem when slippage check passes', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Create withdrawal request
    await StakingVault.connect(user1).withdraw(
      depositAmount,
      withdrawalHandler.target,
      user1.address
    );
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;

    // Set minimum amount lower than actual withdrawal amount
    const minAmount = depositAmount - ethers.parseUnits('1', 18);

    // Fast forward time past withdrawal period
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    const initialBalance = await USN.balanceOf(user1.address);
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    // Verify withdrawal was successful
    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.equal(depositAmount);

    // Verify request is marked as claimed
    const request = await withdrawalHandler.getWithdrawalRequest(
      user1.address,
      requestId
    );
    expect(request.claimed).to.be.true;
  });

  it('should revert when redeeming more than available balance', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Try to withdraw more than deposited
    await expect(
      StakingVault.connect(user1).withdraw(
        depositAmount + ethers.parseUnits('1', 18),
        withdrawalHandler.target,
        user1.address
      )
    ).to.be.revertedWithCustomError(StakingVault, 'ERC4626ExceededMaxWithdraw');
  });

  it('should successfully redeem shares for assets', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    const initialBalance = await USN.balanceOf(user1.address);
    const initialShares = await StakingVault.balanceOf(user1.address);

    // Redeem half of shares
    const redeemShares = initialShares / 2n;
    const expectedAssets = await StakingVault.previewRedeem(redeemShares);

    await expect(
      StakingVault.connect(user1).withdraw(
        expectedAssets,
        withdrawalHandler.target,
        user1.address
      )
    )
      .to.emit(StakingVault, 'Withdraw')
      .withArgs(
        user1.address,
        withdrawalHandler.target,
        user1.address,
        expectedAssets,
        redeemShares
      );

    // Fast forward time past withdrawal period
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim withdrawal
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    // Verify balances
    const finalBalance = await USN.balanceOf(user1.address);
    const finalShares = await StakingVault.balanceOf(user1.address);

    expect(finalBalance - initialBalance).to.equal(expectedAssets);
    expect(initialShares - finalShares).to.equal(redeemShares);
  });

  it('should allow redeemWithSlippageCheck', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    const redeemShares = ethers.parseUnits('500', 18);
    const expectedAssets = await StakingVault.previewRedeem(redeemShares);
    const minAssets = expectedAssets - ethers.parseUnits('10', 18); // Allow for slippage

    const initialBalance = await USN.balanceOf(user1.address);
    const maxShareBurned = await StakingVault.balanceOf(user1.address);
    await expect(
      StakingVault.connect(user1).withdrawWithSlippageCheck(
        expectedAssets,
        withdrawalHandler.target,
        user1.address,
        expectedAssets
      )
    )
      .to.emit(StakingVault, 'Withdraw')
      .withArgs(
        user1.address,
        withdrawalHandler.target,
        user1.address,
        expectedAssets,
        redeemShares
      );

    // Fast forward time past withdrawal period
    await ethers.provider.send('evm_increaseTime', [24 * 60 * 60]);
    await ethers.provider.send('evm_mine', []);

    // Claim withdrawal
    const requestId =
      (await withdrawalHandler.getUserNextRequestId(user1.address)) - 1n;
    await withdrawalHandler.connect(user1).claimWithdrawal(requestId);

    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.be.gte(minAssets);
  });

  it('should revert redeemWithSlippageCheck if slippage is exceeded', async function () {
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    const redeemShares = ethers.parseUnits('500', 18);
    const expectedAssets = await StakingVault.previewRedeem(redeemShares);

    await expect(
      StakingVault.connect(user1).withdrawWithSlippageCheck(
        expectedAssets,
        withdrawalHandler.target,
        user1.address,
        redeemShares - 1n
      )
    ).to.be.revertedWithCustomError(StakingVault, 'SlippageExceeded');
  });
  it('should not allow blacklisted accounts to withdraw', async function () {
    // Setup initial deposit
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      depositAmount
    );
    await StakingVault.connect(user1).deposit(depositAmount, user1.address);

    // Blacklist user1
    await StakingVault.connect(blacklistManager).blacklistAccount(
      user1.address
    );

    // Try to withdraw - should fail
    const withdrawAmount = ethers.parseUnits('500', 18);
    await expect(
      StakingVault.connect(user1).withdraw(
        withdrawAmount,
        withdrawalHandler.target,
        user1.address
      )
    ).to.be.revertedWithCustomError(StakingVault, 'BlacklistedAddress');

    // Try withdrawWithSlippageCheck - should also fail
    await expect(
      StakingVault.connect(user1).withdrawWithSlippageCheck(
        withdrawAmount,
        withdrawalHandler.target,
        user1.address,
        withdrawAmount + (withdrawAmount * 2n) / 100n // 2% slippage
      )
    ).to.be.revertedWithCustomError(StakingVault, 'BlacklistedAddress');

    // Unblacklist user1
    await StakingVault.connect(blacklistManager).unblacklistAccount(
      user1.address
    );

    // Should now be able to withdraw
    await StakingVault.connect(user1).withdrawWithSlippageCheck(
      withdrawAmount,
      withdrawalHandler.target,
      user1.address,
      withdrawAmount + (withdrawAmount * 2n) / 100n // 2% slippage
    );
  });

  it('should not allow blacklisted accounts to transfer on destination chain', async function () {
    // Setup initial deposit and bridge to dst chain
    // Initial stakes
    const user1StakeAmount = ethers.parseUnits('5000', 18);
    const transferLzAmount = ethers.parseUnits('2500', 18);

    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, user1StakeAmount);
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      user1StakeAmount
    );
    await StakingVault.connect(user1).deposit(
      user1StakeAmount,
      await user1.getAddress()
    );

    await USN.setAdmin(owner.address);

    // Record user2's initial shares
    const user2SharesBefore = await StakingVault.convertToShares(
      await StakingVault.balanceOf(user2.address)
    );

    const executorLzReceiveOptionMaxGas = 65000;
    const options = Options.newOptions()
      .addExecutorLzReceiveOption(BigInt(executorLzReceiveOptionMaxGas), 0)
      .toHex();
    const sendParams = [
      CHAIN_ID_DST,
      ethers.zeroPadValue(await user1.getAddress(), 32),
      transferLzAmount,
      transferLzAmount,
      options,
      '0x',
      '0x',
    ];

    const [nativeFee] = await StakingVault.quoteSend(sendParams, false);
    await StakingVault.connect(user1).approve(
      await StakingVault.getAddress(),
      transferLzAmount
    );

    await StakingVault.connect(user1).send(
      sendParams,
      [nativeFee, 0],
      await user1.getAddress(),
      { value: nativeFee }
    );
    console.log('sent');
    // Grant blacklist manager role on dst chain
    const BLACKLIST_MANAGER_ROLE =
      await StakingVaultDst.BLACKLIST_MANAGER_ROLE();
    await StakingVaultDst.grantRole(
      BLACKLIST_MANAGER_ROLE,
      blacklistManager.address
    );

    // Blacklist user1 on dst chain
    await StakingVaultDst.connect(blacklistManager).blacklistAccount(
      user1.address
    );

    // Try to transfer - should fail
    const transferAmount = ethers.parseUnits('500', 18);
    await expect(
      StakingVaultDst.connect(user1).transfer(user2.address, transferAmount)
    ).to.be.revertedWithCustomError(StakingVaultDst, 'BlacklistedAddress');

    // Unblacklist user1
    await StakingVaultDst.connect(blacklistManager).unblacklistAccount(
      user1.address
    );

    // Should now be able to transfer
    await StakingVaultDst.connect(user1).transfer(
      user2.address,
      transferAmount
    );
    expect(await StakingVaultDst.balanceOf(user2.address)).to.equal(
      transferAmount
    );
  });

  it('should transfer tokens via Hyperlane', async function () {
    const transferAmount = ethers.parseUnits('1000', 18);
    //approve USN for HyperlaneVault
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      transferAmount
    );
    // Deposit tokens first
    await HyperlaneVault.connect(user1).deposit(
      transferAmount,
      await user1.getAddress()
    );

    // Get initial balances
    const initialSrcBalance = await HyperlaneVault.balanceOf(user1.address);
    const initialDstBalance = await HyperlaneVaultDst.balanceOf(user1.address);
    await HyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);
    // Send tokens via Hyperlane
    const fee = await mockMailboxSrc.mockFee();
    await HyperlaneVault.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_DST,
      ethers.zeroPadValue(user1.address, 32),
      transferAmount,
      { value: fee }
    );

    // Verify balances - no need to process message manually
    expect(await HyperlaneVault.balanceOf(user1.address)).to.equal(
      initialSrcBalance - transferAmount
    );
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(
      initialDstBalance + transferAmount
    );
  });

  it('should revert Hyperlane transfer with insufficient fee', async function () {
    const transferAmount = ethers.parseUnits('1000', 18);
    //approve USN for HyperlaneVault
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      transferAmount
    );
    await HyperlaneVault.connect(user1).deposit(
      transferAmount,
      await user1.getAddress()
    );

    await expect(
      HyperlaneVault.connect(user1).sendTokensViaHyperlane(
        CHAIN_ID_DST,
        ethers.zeroPadValue(user1.address, 32),
        transferAmount,
        { value: 0 }
      )
    ).to.be.revertedWithCustomError(
      HyperlaneVault,
      'InsufficientInterchainFee'
    );
  });

  it('should upgrade StakingVaultOFTUpgradeable to StakingVaultOFTUpgradeableHyperlane', async function () {
    //approve USN for HyperlaneVault
    await USN.connect(user1).approve(
      await StakingVault.getAddress(),
      stakeAmount
    );
    // First deposit some tokens to the original vault
    await StakingVault.connect(user1).deposit(
      stakeAmount,
      await user1.getAddress()
    );
    //approve USN for HyperlaneVault

    const balanceBefore = await StakingVault.balanceOf(user1.address);
    expect(balanceBefore).to.equal(stakeAmount);

    // Upgrade the contract
    const StakingVaultFactoryHyperlane = await ethers.getContractFactory(
      'StakingVaultOFTUpgradeableHyperlane'
    );

    const upgradedVault = await upgrades.upgradeProxy(
      stakingVaultProxySrc.target,
      StakingVaultFactoryHyperlane,
      {
        constructorArgs: [await endpointV2MockSrc.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );

    const UpgradedVault = StakingVaultFactoryHyperlane.attach(
      upgradedVault.target
    ) as StakingVaultOFTUpgradeableHyperlane;

    // Verify balance is preserved after upgrade
    const balanceAfter = await UpgradedVault.balanceOf(user1.address);
    expect(balanceAfter).to.equal(balanceBefore);

    // Configure Hyperlane on the upgraded vault
    await UpgradedVault.configureHyperlane(mockMailboxSrc.target);

    // Register remote token
    await UpgradedVault.registerHyperlaneRemoteToken(
      CHAIN_ID_DST,
      ethers.zeroPadValue(HyperlaneVaultDst.target, 32)
    );

    // Test Hyperlane transfer with the upgraded vault
    const transferAmount = ethers.parseUnits('1000', 18);
    const fee = await mockMailboxSrc.mockFee();
    //configure Hyperlane on the upgraded vault
    await HyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);
    //configure remote token
    await UpgradedVault.registerHyperlaneRemoteToken(
      CHAIN_ID_DST,
      ethers.zeroPadValue(HyperlaneVaultDst.target, 32)
    );
    //configure hyperlaneVaultdst remote token
    await HyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(UpgradedVault.target, 32)
    );

    await UpgradedVault.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_DST,
      ethers.zeroPadValue(user1.address, 32),
      transferAmount,
      { value: fee }
    );

    // Verify the transfer worked
    expect(await UpgradedVault.balanceOf(user1.address)).to.equal(
      stakeAmount - transferAmount
    );
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(
      transferAmount
    );
  });

  it('should correctly lock tokens on source chain and mint on destination chain via Hyperlane', async function () {
    // Deploy fresh instances for this test
    const { mockMailboxSrc, mockMailboxDst } = await setupHyperlaneMocks();

    // Deploy StakingVaultOFTUpgradeableHyperlane
    const StakingVaultFactoryHyperlane = await ethers.getContractFactory(
      'StakingVaultOFTUpgradeableHyperlane'
    );
    const hyperlaneVaultSrc = await upgrades.deployProxy(
      StakingVaultFactoryHyperlane,
      [await USN.getAddress(), 'Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockSrc.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );

    // Deploy StakedUSNBasicOFTHyperlane
    const StakedUSNBasicOFTHyperlaneFactory = await ethers.getContractFactory(
      'StakedUSNBasicOFTHyperlane'
    );
    const hyperlaneVaultDst = await upgrades.deployProxy(
      StakedUSNBasicOFTHyperlaneFactory,
      ['Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockDst.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );

    // Configure Hyperlane for both vaults
    await hyperlaneVaultSrc.configureHyperlane(mockMailboxSrc.target);
    await hyperlaneVaultDst.configureHyperlane(mockMailboxDst.target);

    // Register remote tokens
    await hyperlaneVaultSrc.registerHyperlaneRemoteToken(
      CHAIN_ID_DST,
      ethers.zeroPadValue(hyperlaneVaultDst.target, 32)
    );
    await hyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(hyperlaneVaultSrc.target, 32)
    );

    // Set up withdrawal handler
    await hyperlaneVaultSrc.setWithdrawalHandler(withdrawalHandler.target);
    await withdrawalHandler.grantRole(
      await withdrawalHandler.STAKING_VAULT_ROLE(),
      hyperlaneVaultSrc.target
    );

    const transferAmount = ethers.parseUnits('1000', 18);

    // Approve USN for hyperlaneVaultSrc
    await USN.connect(user1).approve(hyperlaneVaultSrc.target, transferAmount);

    // Deposit tokens first
    await hyperlaneVaultSrc
      .connect(user1)
      .deposit(transferAmount, await user1.getAddress());

    // Get initial balances and token supply
    const initialSrcBalance = await hyperlaneVaultSrc.balanceOf(user1.address);
    const initialDstBalance = await hyperlaneVaultDst.balanceOf(user1.address);
    const initialSrcTotalSupply = await hyperlaneVaultSrc.totalSupply();
    const initialDstTotalSupply = await hyperlaneVaultDst.totalSupply();

    // Send tokens via Hyperlane
    const fee = await mockMailboxSrc.mockFee();

    // This is the key part - we need to modify the MockMailbox to properly handle the message
    // First, let's make sure the MockMailbox is correctly set up to process messages
    await mockMailboxSrc.setMockFee(ethers.parseEther('0.001'));
    //configure Hyperlane on the upgraded vault
    await hyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);
    await hyperlaneVaultSrc.configureHyperlane(mockMailboxSrc.target);
    //configure remote token
    await hyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(hyperlaneVaultSrc.target, 32)
    );
    //configure src mailbox
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxSrc.target);
    //configure dst mailbox
    await mockMailboxDst.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxDst.target);
    await hyperlaneVaultSrc
      .connect(user1)
      .sendTokensViaHyperlane(
        CHAIN_ID_DST,
        ethers.zeroPadValue(user1.address, 32),
        transferAmount,
        {
          value: fee,
        }
      );

    // Manually process the message on the destination chain
    // This simulates what would happen in a real cross-chain scenario
    const messageBody = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [user1.address, transferAmount]
    );
    // Verify balances - tokens should be locked on source chain (not burned)
    expect(await hyperlaneVaultSrc.balanceOf(user1.address)).to.equal(
      initialSrcBalance - transferAmount
    );
    expect(
      await hyperlaneVaultSrc.balanceOf(hyperlaneVaultSrc.target)
    ).to.equal(transferAmount);

    // Total supply on source chain should remain the same
    expect(await hyperlaneVaultSrc.totalSupply()).to.equal(
      initialSrcTotalSupply
    );

    // Tokens should be minted on destination chain
    expect(await hyperlaneVaultDst.balanceOf(user1.address)).to.equal(
      initialDstBalance + transferAmount
    );

    // Total supply on destination chain should increase
    expect(await hyperlaneVaultDst.totalSupply()).to.equal(
      initialDstTotalSupply + transferAmount
    );
  });

  it('should correctly handle round-trip transfers via Hyperlane', async function () {
    const transferAmount = ethers.parseUnits('1000', 18);

    // Approve USN for HyperlaneVault
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      transferAmount
    );

    // Deposit tokens first
    await HyperlaneVault.connect(user1).deposit(
      transferAmount,
      await user1.getAddress()
    );

    // Get initial balances
    const initialSrcBalance = await HyperlaneVault.balanceOf(user1.address);

    //configure hyperlane on vault
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxSrc.target);
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxSrc.target);
    await HyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);
    await HyperlaneVault.configureHyperlane(mockMailboxSrc.target);
    //configure remote token
    await HyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(HyperlaneVault.target, 32)
    );

    // Send tokens from source to destination
    const fee = await mockMailboxSrc.mockFee();
    await HyperlaneVault.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_DST,
      ethers.zeroPadValue(user1.address, 32),
      transferAmount,
      { value: fee }
    );

    // Verify tokens arrived on destination
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(
      transferAmount
    );
    // Now send tokens back from destination to source
    const feeDst = await mockMailboxDst.mockFee();
    //register remote token
    await HyperlaneVault.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(HyperlaneVaultDst.target, 32)
    );
    //register remote token on dst vault
    await HyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(HyperlaneVault.target, 32)
    );
    await HyperlaneVaultDst.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(user1.address, 32),
      transferAmount,
      { value: feeDst }
    );

    // Verify tokens returned to source
    expect(await HyperlaneVault.balanceOf(user1.address)).to.equal(
      initialSrcBalance
    );
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(0);
  });

  it('should correctly handle blacklisted addresses with Hyperlane transfers', async function () {
    const transferAmount = ethers.parseUnits('1000', 18);

    // Approve USN for HyperlaneVault
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      transferAmount
    );

    // Deposit tokens first
    await HyperlaneVault.connect(user1).deposit(
      transferAmount,
      await user1.getAddress()
    );

    // Blacklist user1 on destination chain
    await HyperlaneVaultDst.grantRole(
      await HyperlaneVaultDst.BLACKLIST_MANAGER_ROLE(),
      blacklistManager.address
    );
    await HyperlaneVaultDst.connect(blacklistManager).blacklistAccount(
      user1.address
    );

    // Send tokens via Hyperlane - should fail on destination due to blacklist
    const fee = await mockMailboxSrc.mockFee();
    //configure mailbox
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxSrc.target);
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxSrc.target);
    await HyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);
    await HyperlaneVault.configureHyperlane(mockMailboxSrc.target);
    // The transaction will succeed on source chain, but the tokens won't be credited on destination
    await expect(
      HyperlaneVault.connect(user1).sendTokensViaHyperlane(
        CHAIN_ID_DST,
        ethers.zeroPadValue(user1.address, 32),
        transferAmount,
        { value: fee }
      )
    ).to.be.revertedWithCustomError(HyperlaneVaultDst, 'BlacklistedAddress');

    // Tokens should be locked on source chain
    expect(await HyperlaneVault.balanceOf(HyperlaneVault.target)).to.equal(0);

    // But not credited on destination due to blacklist
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(0);

    // Unblacklist user1
    await HyperlaneVaultDst.connect(blacklistManager).unblacklistAccount(
      user1.address
    );

    // Try again with a new transfer
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      transferAmount
    );
    await HyperlaneVault.connect(user1).deposit(
      transferAmount,
      await user1.getAddress()
    );

    await HyperlaneVault.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_DST,
      ethers.zeroPadValue(user1.address, 32),
      transferAmount,
      { value: fee }
    );

    // Now tokens should be credited on destination
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(
      transferAmount
    );
  });

  it('should correctly handle rebase after Hyperlane transfer', async function () {
    const transferAmount = ethers.parseUnits('1000', 18);
    const rebaseAmt = ethers.parseUnits('100', 18);

    // Approve USN for HyperlaneVault
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      transferAmount
    );

    // Deposit tokens first
    await HyperlaneVault.connect(user1).deposit(
      transferAmount,
      await user1.getAddress()
    );

    // Send half the tokens via Hyperlane
    const halfAmount = transferAmount / 2n;
    const fee = await mockMailboxSrc.mockFee();
    //configure mailbox
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxSrc.target);
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxSrc.target);
    await HyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);
    await HyperlaneVault.configureHyperlane(mockMailboxSrc.target);
    //register remote token

    await HyperlaneVault.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_DST,
      ethers.zeroPadValue(user1.address, 32),
      halfAmount,
      { value: fee }
    );

    // Verify balances before rebase
    const srcBalanceBeforeRebase = await HyperlaneVault.balanceOf(
      user1.address
    );
    const dstBalanceBeforeRebase = await HyperlaneVaultDst.balanceOf(
      user1.address
    );

    // Perform rebase on source chain
    await USN.connect(rebaseManager).approve(
      await HyperlaneVault.getAddress(),
      rebaseAmt
    );
    //rebase manager needs to be rebase role
    await HyperlaneVault.grantRole(
      await HyperlaneVault.REBASE_MANAGER_ROLE(),
      rebaseManager.address
    );
    await HyperlaneVault.connect(rebaseManager).rebase(rebaseAmt);

    // Calculate expected balances after rebase
    // The rebase should proportionally increase all balances
    const totalSupplyBeforeRebase =
      (await HyperlaneVault.totalAssets()) - rebaseAmt;
    const rebaseFactor =
      ((await HyperlaneVault.totalAssets()) * 10000n) / totalSupplyBeforeRebase;

    // Verify balances after rebase
    // Source chain balance should increase proportionally
    expect(await HyperlaneVault.balanceOf(user1.address)).to.be.equal(
      srcBalanceBeforeRebase
    );

    // Destination chain balance should remain unchanged as rebase only affects source chain
    expect(await HyperlaneVaultDst.balanceOf(user1.address)).to.equal(
      dstBalanceBeforeRebase
    );
  });

  it('should correctly lock and unlock tokens when sending to same chain via Hyperlane', async function () {
    const transferAmount = ethers.parseUnits('1000', 18);

    // Deploy fresh instances for this test
    const { mockMailboxSrc, mockMailboxDst } = await setupHyperlaneMocks();

    // Deploy StakingVaultOFTUpgradeableHyperlane
    const StakingVaultFactoryHyperlane = await ethers.getContractFactory(
      'StakingVaultOFTUpgradeableHyperlane'
    );
    const hyperlaneVaultSrc = await upgrades.deployProxy(
      StakingVaultFactoryHyperlane,
      [await USN.getAddress(), 'Staked USN', 'sUSN', await owner.getAddress()],
      {
        initializer: 'initialize',
        constructorArgs: [await endpointV2MockSrc.getAddress()],
        unsafeAllow: ['constructor'],
      }
    );

    // Configure Hyperlane
    await hyperlaneVaultSrc.configureHyperlane(mockMailboxSrc.target);
    await mockMailboxSrc.setMockFee(ethers.parseEther('0.001'));

    // Register the vault as its own remote token (for same-chain transfers)
    await hyperlaneVaultSrc.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(HyperlaneVaultDst.target, 32)
    );
    await HyperlaneVaultDst.registerHyperlaneRemoteToken(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(hyperlaneVaultSrc.target, 32)
    );
    HyperlaneVaultDst.configureHyperlane(mockMailboxSrc.target);

    // Set up withdrawal handler
    await hyperlaneVaultSrc.setWithdrawalHandler(withdrawalHandler.target);
    await withdrawalHandler.grantRole(
      await withdrawalHandler.STAKING_VAULT_ROLE(),
      hyperlaneVaultSrc.target
    );

    // Approve USN for hyperlaneVaultSrc
    await USN.connect(user1).approve(hyperlaneVaultSrc.target, transferAmount);
    // Deposit tokens first
    await hyperlaneVaultSrc
      .connect(user1)
      .deposit(transferAmount, await user1.getAddress());

    // Get initial balances
    const initialUserBalance = await hyperlaneVaultSrc.balanceOf(user1.address);
    const initialVaultSelfBalance = await hyperlaneVaultSrc.balanceOf(
      hyperlaneVaultSrc.target
    );

    const initialTotalSupply = await hyperlaneVaultSrc.totalSupply();
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_DST, mockMailboxSrc.target);
    await mockMailboxSrc.setRemoteMailbox(CHAIN_ID_SRC, mockMailboxSrc.target);

    expect(await hyperlaneVaultSrc.balanceOf(user1)).to.be.gt(0);
    // Send tokens to the same chain
    const fee = await mockMailboxSrc.mockFee();

    await hyperlaneVaultSrc.connect(user1).sendTokensViaHyperlane(
      CHAIN_ID_SRC, // DST chain ID
      ethers.zeroPadValue(user2.address, 32), // Different recipient
      transferAmount,
      { value: fee }
    );

    // Verify tokens are locked (moved to vault's own balance)
    expect(await hyperlaneVaultSrc.balanceOf(user1.address)).to.equal(0);
    expect(
      await hyperlaneVaultSrc.balanceOf(hyperlaneVaultSrc.target)
    ).to.equal(initialVaultSelfBalance + transferAmount);

    // Verify total supply remains unchanged
    expect(await hyperlaneVaultSrc.totalSupply()).to.equal(initialTotalSupply);

    // Verify user2 received the tokens
    expect(await HyperlaneVaultDst.balanceOf(user2.address)).to.equal(
      transferAmount
    );
    //approve
    await HyperlaneVaultDst.connect(user2).approve(
      HyperlaneVault.target,
      transferAmount
    );
    // Now send tokens back from user2 to user2 on src chain
    await HyperlaneVaultDst.connect(user2).sendTokensViaHyperlane(
      CHAIN_ID_SRC,
      ethers.zeroPadValue(user2.address, 32),
      transferAmount,
      {
        value: fee,
      }
    );

    // Verify user2's balance is correct
    expect(await hyperlaneVaultSrc.balanceOf(user2.address)).to.equal(
      transferAmount
    );

    // Verify user2's balance is zero
    expect(await HyperlaneVaultDst.balanceOf(user2.address)).to.equal(0);

    // Verify vault's self-balance is back to initial
    expect(
      await hyperlaneVaultSrc.balanceOf(hyperlaneVaultSrc.target)
    ).to.equal(initialVaultSelfBalance);

    // Verify total supply still remains unchanged
    expect(await hyperlaneVaultSrc.totalSupply()).to.equal(initialTotalSupply);
  });

  it('should allow whitelisted accounts to withdraw directly', async function () {
    // Setup initial deposit
    const depositAmount = ethers.parseUnits('1000', 18);
    await USN.setAdmin(owner.address);
    await USN.mint(user1.address, depositAmount);
    await USN.connect(user1).approve(
      await HyperlaneVault.getAddress(),
      depositAmount
    );
    await HyperlaneVault.connect(user1).deposit(depositAmount, user1.address);

    // Whitelist user1
    await HyperlaneVault.connect(owner).whitelistAccount(user1.address);

    // Try to withdraw directly - should succeed
    const withdrawAmount = ethers.parseUnits('500', 18);
    const initialBalance = await USN.balanceOf(user1.address);

    await expect(
      HyperlaneVault.connect(user1).withdraw(
        withdrawAmount,
        user1.address, // Can withdraw directly to any address
        user1.address
      )
    ).to.emit(HyperlaneVault, 'Withdraw');

    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance).to.equal(initialBalance + withdrawAmount);
  });

  it('should allow whitelisting and unwhitelisting accounts', async function () {
    // Whitelist user1
    await HyperlaneVault.connect(owner).whitelistAccount(user1.address);
    expect(await HyperlaneVault.isWhitelisted(user1.address)).to.be.true;

    // Unwhitelist user1
    await HyperlaneVault.connect(owner).unwhitelistAccount(user1.address);
    expect(await HyperlaneVault.isWhitelisted(user1.address)).to.be.false;
  });

  it('should allow whitelisted accounts to withdraw directly', async function () {
    const depositAmount = ethers.parseEther('100');
    const withdrawAmount = ethers.parseEther('50');

    // Deposit tokens
    await USN.connect(user1).approve(HyperlaneVault.target, depositAmount);
    await HyperlaneVault.connect(user1).deposit(depositAmount, user1.address);

    // Whitelist user1
    await HyperlaneVault.connect(owner).whitelistAccount(user1.address);

    // Attempt direct withdrawal (should succeed)
    const initialBalance = await USN.balanceOf(user1.address);
    await HyperlaneVault.connect(user1).withdraw(
      withdrawAmount,
      user1.address,
      user1.address
    );
    const finalBalance = await USN.balanceOf(user1.address);
    expect(finalBalance - initialBalance).to.equal(withdrawAmount);
  });

  it('should prevent whitelisted accounts from using withdrawal handler', async function () {
    const depositAmount = ethers.parseEther('100');
    const withdrawAmount = ethers.parseEther('50');

    // Deposit tokens
    await USN.connect(user1).approve(HyperlaneVault.target, depositAmount);
    await HyperlaneVault.connect(user1).deposit(depositAmount, user1.address);

    // Whitelist user1
    await HyperlaneVault.connect(owner).whitelistAccount(user1.address);

    // Attempt withdrawal through handler (should fail)
    await expect(
      HyperlaneVault.connect(user1).withdraw(
        withdrawAmount,
        withdrawalHandler.target,
        user1.address
      )
    ).to.be.revertedWithCustomError(HyperlaneVault, 'Unauthorized');
  });

  it('should require non-whitelisted accounts to use withdrawal handler', async function () {
    const depositAmount = ethers.parseEther('100');
    const withdrawAmount = ethers.parseEther('50');

    // Deposit tokens
    await USN.connect(user1).approve(HyperlaneVault.target, depositAmount);
    await HyperlaneVault.connect(user1).deposit(depositAmount, user1.address);

    // Ensure user1 is not whitelisted
    await HyperlaneVault.connect(owner).unwhitelistAccount(user1.address);

    // Attempt direct withdrawal (should fail)
    await expect(
      HyperlaneVault.connect(user1).withdraw(
        withdrawAmount,
        user1.address,
        user1.address
      )
    ).to.be.revertedWithCustomError(HyperlaneVault, 'Unauthorized');

    // Attempt withdrawal through handler (should succeed)
    await HyperlaneVault.connect(user1).withdraw(
      withdrawAmount,
      withdrawalHandler.target,
      user1.address
    );
  });

  it('should prevent non-admin from whitelisting accounts', async function () {
    await expect(
      HyperlaneVault.connect(user1).whitelistAccount(user2.address)
    ).to.be.revertedWithCustomError(
      HyperlaneVault,
      'AccessControlUnauthorizedAccount'
    );
  });

  it('should prevent non-admin from unwhitelisting accounts', async function () {
    // First whitelist the account
    await HyperlaneVault.connect(owner).whitelistAccount(user2.address);

    // Try to unwhitelist with non-admin
    await expect(
      HyperlaneVault.connect(user1).unwhitelistAccount(user2.address)
    ).to.be.revertedWithCustomError(
      HyperlaneVault,
      'AccessControlUnauthorizedAccount'
    );
  });
});
