import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { USN, MinterHandler } from '../typechain-types';

if (!process.env.MAINNET_RPC_URL) {
  throw new Error(
    'MAINNET_RPC_URL environment variable must be set to run fork tests.'
  );
}

describe('RedeemHandlerV2 Fork Tests', function () {
  let usn: USN;
  let redeemHandler: any;
  let minterHandler: MinterHandler;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let accountant: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let whale: HardhatEthersSigner;
  let endpointV2Mock: any;
  let usdtContract: any;
  let oracleContract: any;

  // Mainnet addresses
  const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
  const USDT_ORACLE = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D';
  const WHALE_ADDRESS = '0xF977814e90dA44bFA03b6295A0616a897441aceC';

  // Test amounts
  const usdtAmount = ethers.parseUnits('1000', 6); // 1000 USDT (6 decimals)
  const usnAmount = ethers.parseUnits('1000', 18); // 1000 USN (18 decimals)
  const pegPrice = 100000000; // $1.00 in 8 decimals

  beforeEach(async function () {
    // Fork mainnet
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_RPC_URL,
            blockNumber: 18500000, // Use a stable block number
          },
        },
      ],
    });

    [owner, user, accountant, treasury] = await ethers.getSigners();

    // Impersonate whale account
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WHALE_ADDRESS],
    });
    whale = await ethers.getSigner(WHALE_ADDRESS);

    // Deploy mock LayerZero endpoint
    const EndpointV2Mock = await ethers.getContractFactory('EndpointV2Mock');
    endpointV2Mock = await EndpointV2Mock.deploy(5434);

    // Deploy USN
    const USNFactory = await ethers.getContractFactory('USN');
    usn = await USNFactory.deploy(endpointV2Mock.target);
    await usn.waitForDeployment();
    await usn.enablePermissionless();

    // Deploy RedeemHandlerV2
    const RedeemHandlerV2Factory =
      await ethers.getContractFactory('RedeemHandlerV2');
    redeemHandler = await RedeemHandlerV2Factory.deploy(await usn.getAddress());
    await redeemHandler.waitForDeployment();

    // Deploy MinterHandler
    const MinterHandlerFactory =
      await ethers.getContractFactory('MinterHandler');
    minterHandler = await MinterHandlerFactory.deploy(await usn.getAddress());
    await minterHandler.waitForDeployment();

    // Get USDT and Oracle contracts
    usdtContract = await ethers.getContractAt('IERC20Metadata', USDT_ADDRESS);
    oracleContract = await ethers.getContractAt(
      [
        'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
        'function decimals() external view returns (uint8)',
      ],
      USDT_ORACLE
    );

    // Set up roles
    await usn.setAdmin(await minterHandler.getAddress());
    await redeemHandler.grantRole(
      await redeemHandler.BURNER_ROLE(),
      owner.address
    );
    await redeemHandler.grantRole(
      await redeemHandler.ACCOUNTANT_ROLE(),
      accountant.address
    );

    // Set treasury
    await redeemHandler.setTreasury(treasury.address);

    // Add USDT as redeemable collateral with oracle and peg price
    await redeemHandler.addRedeemableCollateral(
      USDT_ADDRESS,
      USDT_ORACLE,
      pegPrice
    );

    // Whitelist user for redemption
    await redeemHandler.addWhitelistedUser(user.address);

    // Transfer USDT from whale to treasury for testing
    await usdtContract
      .connect(whale)
      .transfer(treasury.address, usdtAmount * 10n);

    // Approve RedeemHandler to spend from treasury
    await usdtContract
      .connect(treasury)
      .approve(await redeemHandler.getAddress(), ethers.MaxUint256);

    // Set USN admin to owner for minting test tokens
    await usn.setAdmin(owner.address);
    await usn.mint(user.address, usnAmount * 5n);
  });

  describe('Oracle Integration', function () {
    it('should fetch current USDT price from Chainlink oracle', async function () {
      const [price, updatedAt] =
        await redeemHandler.getCollateralPrice(USDT_ADDRESS);

      expect(price).to.be.gt(0);
      expect(updatedAt).to.be.gt(0);

      // Price should be around $1 (in 8 decimals, so around 100000000)
      expect(price).to.be.closeTo(BigInt(pegPrice), BigInt(pegPrice) / 10n); // Within 10% of peg

      // Updated time should be recent (within 24 hours as per staleness threshold)
      const block = await ethers.provider.getBlock('latest');
      if (!block) throw new Error('Could not fetch latest block');
      const currentTime = block.timestamp;
      expect(updatedAt).to.be.gt(currentTime - 86400);
    });

    it('should calculate correct collateral amount based on oracle price', async function () {
      const calculatedAmount = await redeemHandler.calculateCollateralAmount(
        USDT_ADDRESS,
        usnAmount
      );

      // Should be approximately 1000 USDT (in 6 decimals) for 1000 USN
      expect(calculatedAmount).to.be.closeTo(usdtAmount, usdtAmount / 100n); // Within 1%
    });

    it('should have correct oracle staleness threshold', async function () {
      expect(await redeemHandler.ORACLE_STALENESS_THRESHOLD()).to.equal(86400);
    });
  });

  describe('Treasury-Based Redemptions', function () {
    beforeEach(async function () {
      // Approve USN for redemption
      await usn
        .connect(user)
        .approve(await redeemHandler.getAddress(), usnAmount);
    });

    it('should perform onchain redemption successfully', async function () {
      const userUsdtBefore = await usdtContract.balanceOf(user.address);
      const userUsnBefore = await usn.balanceOf(user.address);
      const treasuryUsdtBefore = await usdtContract.balanceOf(treasury.address);

      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, usnAmount)
      ).to.emit(redeemHandler, 'Redeemed');

      const userUsdtAfter = await usdtContract.balanceOf(user.address);
      const userUsnAfter = await usn.balanceOf(user.address);
      const treasuryUsdtAfter = await usdtContract.balanceOf(treasury.address);

      // User should receive USDT and lose USN
      expect(userUsdtAfter).to.be.gt(userUsdtBefore);
      expect(userUsnAfter).to.equal(userUsnBefore - usnAmount);

      // Treasury should lose USDT
      expect(treasuryUsdtAfter).to.be.lt(treasuryUsdtBefore);
    });

    it('should check treasury balance before redemption', async function () {
      // Empty treasury
      const treasuryBalance = await usdtContract.balanceOf(treasury.address);
      await usdtContract
        .connect(treasury)
        .transfer(whale.address, treasuryBalance);

      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, usnAmount)
      ).to.be.revertedWithCustomError(
        redeemHandler,
        'InsufficientTreasuryBalance'
      );
    });

    it('should get treasury balance correctly', async function () {
      const balance = await redeemHandler.getTreasuryBalance(USDT_ADDRESS);
      const actualBalance = await usdtContract.balanceOf(treasury.address);
      expect(balance).to.equal(actualBalance);
    });
  });

  describe('Peg Percentage System', function () {
    it('should initialize with 100% peg', async function () {
      expect(await redeemHandler.getCurrentPegPercentage()).to.equal(10000);
    });

    it('should allow accountant to set peg percentage', async function () {
      const newPeg = 9500; // 95%

      await expect(redeemHandler.connect(accountant).setPegPercentage(newPeg))
        .to.emit(redeemHandler, 'PegPercentageUpdated')
        .withArgs(newPeg);

      expect(await redeemHandler.getCurrentPegPercentage()).to.equal(newPeg);
    });

    it('should not allow setting peg above 100%', async function () {
      await expect(
        redeemHandler.connect(accountant).setPegPercentage(10001)
      ).to.be.revertedWithCustomError(redeemHandler, 'InvalidPegPercentage');
    });

    it('should apply peg percentage to redemptions', async function () {
      // Set peg to 95%
      await redeemHandler.connect(accountant).setPegPercentage(9500);

      const calculatedAmount = await redeemHandler.calculateCollateralAmount(
        USDT_ADDRESS,
        usnAmount
      );

      // Should be approximately 95% of expected amount
      const expectedBase = usdtAmount;
      const expectedAdjusted = (expectedBase * 9500n) / 10000n;

      expect(calculatedAmount).to.be.closeTo(
        expectedAdjusted,
        expectedAdjusted / 100n
      );
    });

    it('should not allow non-accountant to set peg percentage', async function () {
      await expect(
        redeemHandler.connect(user).setPegPercentage(9000)
      ).to.be.revertedWithCustomError(
        redeemHandler,
        'AccessControlUnauthorizedAccount'
      );
    });
  });

  describe('Deviation and Depeg Policy', function () {
    it('should use peg price for calculation if oracle price is below peg and allow redemption', async function () {
      // No need to set peg price anymore; always 1.00
      // Just check the calculation logic directly
      const calculated = await redeemHandler.calculateCollateralAmount(
        USDT_ADDRESS,
        usnAmount
      );
      // Should be exactly the same as if price == pegPrice (1.00)
      const expected = usdtAmount; // 1000 USN -> 1000 USDT at peg
      expect(calculated).to.be.closeTo(expected, expected / 100n);
    });
    it('should not block redemption if price is below peg', async function () {
      // Approve USN for redemption
      await usn
        .connect(user)
        .approve(await redeemHandler.getAddress(), usnAmount);
      // Redemption should succeed even if price is below peg
      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, usnAmount)
      ).to.emit(redeemHandler, 'Redeemed');
    });
  });

  describe('Rate Views', function () {
    it('should return 1e18 for getRate() at 100% peg', async function () {
      expect(await redeemHandler['getRate()']()).to.equal(
        ethers.parseUnits('1', 18)
      );
    });
    it('should return correct value for getRate() at 95% peg', async function () {
      await redeemHandler.connect(accountant).setPegPercentage(9500);
      expect(await redeemHandler['getRate()']()).to.equal(
        ethers.parseUnits('0.95', 18)
      );
    });
    it('should return correct collateral amount for getRate(address collateral) at 100% peg', async function () {
      const rate = await redeemHandler['getRate(address)'](USDT_ADDRESS);
      // For 1 USN, should get ~1 USDT (6 decimals)
      expect(rate).to.be.closeTo(
        ethers.parseUnits('1', 6),
        ethers.parseUnits('0.01', 6)
      );
    });
    it('should return correct collateral amount for getRate(address collateral) at 95% peg', async function () {
      await redeemHandler.connect(accountant).setPegPercentage(9500);
      const rate = await redeemHandler['getRate(address)'](USDT_ADDRESS);
      // Should be ~0.95 USDT (6 decimals)
      expect(rate).to.be.closeTo(
        ethers.parseUnits('0.95', 6),
        ethers.parseUnits('0.01', 6)
      );
    });
  });

  describe('Depeg Protection', function () {
    it('should detect when collateral is not depegged', async function () {
      const [isDepegged, depegPercentage] =
        await redeemHandler.isCollateralDepegged(USDT_ADDRESS);

      // USDT should not be significantly depegged on mainnet
      expect(isDepegged).to.be.false;
      expect(depegPercentage).to.be.lt(500); // Less than 5%
    });

    it('should get comprehensive depeg status', async function () {
      const status = await redeemHandler.getCollateralDepegStatus(USDT_ADDRESS);

      expect(status.currentPrice).to.be.gt(0);
      expect(status.pegPrice).to.equal(pegPrice);
      expect(status.onchainRedeemAllowed).to.be.true;
    });
  });

  describe('Decimal Handling', function () {
    it('should handle USDT 6 decimals correctly', async function () {
      // Verify USDT has 6 decimals
      expect(await usdtContract.decimals()).to.equal(6);

      // Verify stored decimals match
      expect(await redeemHandler.collateralDecimals(USDT_ADDRESS)).to.equal(6);
    });

    it('should calculate correct amounts for different USN amounts', async function () {
      const testAmounts = [
        ethers.parseUnits('1', 18), // 1 USN
        ethers.parseUnits('100', 18), // 100 USN
        ethers.parseUnits('1000', 18), // 1000 USN
        ethers.parseUnits('0.5', 18), // 0.5 USN
      ];

      for (const amount of testAmounts) {
        const calculated = await redeemHandler.calculateCollateralAmount(
          USDT_ADDRESS,
          amount
        );

        // Should be proportional (approximately same USD value)
        expect(calculated).to.be.gt(0);

        // For 1 USN ≈ 1 USD, should get approximately equivalent USDT
        const expectedUsdtWei = amount / 10n ** 12n; // Convert 18 decimals to 6 decimals
        expect(calculated).to.be.closeTo(
          expectedUsdtWei,
          expectedUsdtWei / 10n
        ); // Within 10%
      }
    });
  });

  describe('Access Control', function () {
    it('should have correct roles set up', async function () {
      const adminRole = await redeemHandler.DEFAULT_ADMIN_ROLE();
      const burnerRole = await redeemHandler.BURNER_ROLE();
      const accountantRole = await redeemHandler.ACCOUNTANT_ROLE();

      expect(await redeemHandler.hasRole(adminRole, owner.address)).to.be.true;
      expect(await redeemHandler.hasRole(burnerRole, owner.address)).to.be.true;
      expect(await redeemHandler.hasRole(accountantRole, accountant.address)).to
        .be.true;
    });

    it('should only allow admin to set treasury', async function () {
      const newTreasury = user.address;

      await expect(
        redeemHandler.connect(user).setTreasury(newTreasury)
      ).to.be.revertedWithCustomError(
        redeemHandler,
        'AccessControlUnauthorizedAccount'
      );

      await expect(
        redeemHandler.connect(owner).setTreasury(newTreasury)
      ).to.emit(redeemHandler, 'TreasuryUpdated');
    });
  });

  describe('Error Scenarios', function () {
    it('should revert for invalid collateral address', async function () {
      await usn
        .connect(user)
        .approve(await redeemHandler.getAddress(), usnAmount);

      await expect(
        redeemHandler.connect(user).redeemOnchain(ethers.ZeroAddress, usnAmount)
      ).to.be.revertedWithCustomError(
        redeemHandler,
        'InvalidCollateralAddress'
      );
    });

    it('should revert for zero amounts', async function () {
      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, 0)
      ).to.be.revertedWithCustomError(redeemHandler, 'ZeroAmount');
    });

    it('should revert for insufficient allowance', async function () {
      // Don't approve USN
      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, usnAmount)
      ).to.be.revertedWithCustomError(redeemHandler, 'InsufficientAllowance');
    });
  });

  describe('Events', function () {
    it('should emit OracleDataUsed event during redemption', async function () {
      await usn
        .connect(user)
        .approve(await redeemHandler.getAddress(), usnAmount);

      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, usnAmount)
      ).to.emit(redeemHandler, 'OracleDataUsed');
    });
  });

  describe('Whitelisting', function () {
    it('should allow admin to add and remove whitelisted user', async function () {
      // Add
      await expect(redeemHandler.addWhitelistedUser(owner.address))
        .to.emit(redeemHandler, 'WhitelistedUserAdded')
        .withArgs(owner.address);
      expect(await redeemHandler.isWhitelisted(owner.address)).to.be.true;
      // Remove
      await expect(redeemHandler.removeWhitelistedUser(owner.address))
        .to.emit(redeemHandler, 'WhitelistedUserRemoved')
        .withArgs(owner.address);
      expect(await redeemHandler.isWhitelisted(owner.address)).to.be.false;
    });
    it('should revert if non-admin tries to add or remove whitelisted user', async function () {
      await expect(
        redeemHandler.connect(user).addWhitelistedUser(user.address)
      ).to.be.revertedWithCustomError(
        redeemHandler,
        'AccessControlUnauthorizedAccount'
      );
      await expect(
        redeemHandler.connect(user).removeWhitelistedUser(user.address)
      ).to.be.revertedWithCustomError(
        redeemHandler,
        'AccessControlUnauthorizedAccount'
      );
    });
    it('should revert if user is not whitelisted for redemption', async function () {
      // Remove user from whitelist
      await redeemHandler.removeWhitelistedUser(user.address);
      await usn
        .connect(user)
        .approve(await redeemHandler.getAddress(), usnAmount);
      await expect(
        redeemHandler.connect(user).redeemOnchain(USDT_ADDRESS, usnAmount)
      ).to.be.revertedWithCustomError(redeemHandler, 'UserNotWhitelisted');
    });
    it('should revert if adding already whitelisted user', async function () {
      await expect(
        redeemHandler.addWhitelistedUser(user.address)
      ).to.be.revertedWithCustomError(redeemHandler, 'UserAlreadyWhitelisted');
    });
    it('should revert if removing non-whitelisted user', async function () {
      await redeemHandler.removeWhitelistedUser(user.address);
      await expect(
        redeemHandler.removeWhitelistedUser(user.address)
      ).to.be.revertedWithCustomError(redeemHandler, 'UserNotWhitelisted');
    });
  });

  after(async function () {
    // Stop impersonating
    if (process.env.MAINNET_RPC_URL) {
      await network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [WHALE_ADDRESS],
      });
    }
  });
});
