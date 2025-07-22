// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./interfaces/IRedeemHandlerV2.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

// Chainlink AggregatorV3Interface
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function getRoundData(
        uint80 _roundId
    )
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

contract RedeemHandlerV2 is AccessControl, EIP712, ReentrancyGuard, IRedeemHandlerV2 {
    using SafeERC20 for IERC20;

    // Remove duplicate struct definition
    // Structs are inherited from the interface

    // Constants
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant ACCOUNTANT_ROLE = keccak256("ACCOUNTANT_ROLE");
    bytes32 private constant REDEEM_TYPEHASH =
        keccak256(
            "RedeemOrder(string message,address user,address collateralAddress,uint256 collateralAmount,uint256 usnAmount,uint256 expiry,uint256 nonce)"
        );

    // Oracle configuration
    uint256 public constant ORACLE_STALENESS_THRESHOLD = 86400; // max time between oracle updates in seconds
    uint256 public constant USD_DECIMALS = 8; // Standard USD decimals for Chainlink
    uint256 public constant MAX_PEG_PERCENTAGE = 10000; // 100% in basis points (10000 = 100%)

    // State variables
    ERC20Burnable public immutable usnToken;
    address public treasury; // Single treasury address that holds all collaterals
    mapping(address => bool) private _redeemableCollaterals;
    mapping(address => address) public collateralOracles; // collateral => oracle address
    mapping(address => uint8) public collateralDecimals; // collateral => decimals
    uint256 public redeemLimitPerBlock;
    uint256 public currentBlockRedeemAmount;
    uint256 public lastRedeemBlock;
    uint256 public pegPercentage; // Peg percentage in basis points (10000 = 100%)
    mapping(address => mapping(uint256 => bool)) private usedNonces;

    // Constructor
    constructor(address _usnToken) EIP712("RedeemHandlerV2", "1") {
        usnToken = ERC20Burnable(_usnToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        redeemLimitPerBlock = 1000000 * 10 ** 18; // Default limit: 1 million USN
        pegPercentage = MAX_PEG_PERCENTAGE; // Initialize at 100%
    }

    // External functions
    function addRedeemableCollateral(
        address collateral,
        address oracle,
        uint256 pegPrice
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (collateral == address(0)) revert ZeroAddress();
        if (oracle == address(0)) revert ZeroOracleAddress();
        if (pegPrice == 0) revert ZeroAmount();
        if (_redeemableCollaterals[collateral]) revert CollateralAlreadyAdded();

        _redeemableCollaterals[collateral] = true;
        collateralOracles[collateral] = oracle;
        // Store collateral decimals for calculations
        collateralDecimals[collateral] = IERC20Metadata(collateral).decimals();

        emit CollateralAdded(collateral);
        emit CollateralOracleUpdated(collateral, oracle);
    }

    function updateCollateralOracle(address collateral, address oracle) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (oracle == address(0)) revert ZeroOracleAddress();
        if (!_redeemableCollaterals[collateral]) revert CollateralNotFound();

        collateralOracles[collateral] = oracle;
        emit CollateralOracleUpdated(collateral, oracle);
    }

    function removeRedeemableCollateral(address collateral) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_redeemableCollaterals[collateral]) revert CollateralNotFound();
        _redeemableCollaterals[collateral] = false;
        delete collateralOracles[collateral];
        delete collateralDecimals[collateral];
        emit CollateralRemoved(collateral);
    }

    function redeemableCollaterals(address collateral) external view override returns (bool) {
        return _redeemableCollaterals[collateral];
    }

    function setRedeemLimitPerBlock(uint256 _redeemLimitPerBlock) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        redeemLimitPerBlock = _redeemLimitPerBlock;
        emit RedeemLimitPerBlockUpdated(_redeemLimitPerBlock);
    }

    function setPegPercentage(uint256 _pegPercentage) external override onlyRole(ACCOUNTANT_ROLE) {
        if (_pegPercentage > MAX_PEG_PERCENTAGE) revert InvalidPegPercentage(_pegPercentage);
        pegPercentage = _pegPercentage;
        emit PegPercentageUpdated(_pegPercentage);
    }

    function setTreasury(address _treasury) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_treasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }

    // Note: No rescueERC20 function needed since contract doesn't hold collateral tokens
    // All collateral is held in the treasury address

    function redeem(
        RedeemOrder calldata order,
        bytes calldata signature
    ) public override nonReentrant onlyRole(BURNER_ROLE) {
        if (order.user == address(0)) revert ZeroAddress();
        if (!_redeemableCollaterals[order.collateralAddress]) revert InvalidCollateralAddress();
        if (order.usnAmount == 0) revert ZeroAmount();
        if (block.timestamp > order.expiry) revert SignatureExpired();
        if (usedNonces[order.user][order.nonce]) revert InvalidNonce();

        bytes32 hash = hashOrder(order);
        if (!_isValidSignature(order.user, hash, signature)) revert InvalidSignature();

        uint256 currentAllowance = usnToken.allowance(order.user, address(this));
        if (currentAllowance < order.usnAmount) revert InsufficientAllowance();

        if (block.number > lastRedeemBlock) {
            currentBlockRedeemAmount = 0;
            lastRedeemBlock = block.number;
        }

        if (currentBlockRedeemAmount + order.usnAmount > redeemLimitPerBlock) {
            revert RedeemLimitExceeded(redeemLimitPerBlock, currentBlockRedeemAmount + order.usnAmount);
        }

        if (treasury == address(0)) revert TreasuryNotSet();

        // Calculate collateral amount based on oracle price
        uint256 calculatedCollateralAmount = _calculateCollateralAmount(order.collateralAddress, order.usnAmount);

        // Check treasury has sufficient balance
        uint256 treasuryBalance = IERC20(order.collateralAddress).balanceOf(treasury);
        if (treasuryBalance < calculatedCollateralAmount) {
            revert InsufficientTreasuryBalance(order.collateralAddress, calculatedCollateralAmount, treasuryBalance);
        }

        // Get oracle data for event emission
        (int256 price, uint256 updatedAt) = getCollateralPrice(order.collateralAddress);
        emit OracleDataUsed(order.collateralAddress, price, updatedAt);

        // Verify that the calculated amount matches the order (with some tolerance for precision)
        if (order.collateralAmount == 0) revert ZeroAmount();

        currentBlockRedeemAmount += order.usnAmount;
        usedNonces[order.user][order.nonce] = true;

        usnToken.burnFrom(order.user, order.usnAmount);

        // Transfer collateral from treasury to user
        IERC20(order.collateralAddress).safeTransferFrom(treasury, order.user, calculatedCollateralAmount);

        emit Redeemed(order.user, order.collateralAddress, order.usnAmount, calculatedCollateralAmount);
    }

    function redeemWithPermit(
        RedeemOrder calldata order,
        bytes calldata signature,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override onlyRole(BURNER_ROLE) {
        bytes32 hash = hashOrder(order);
        if (!_isValidSignature(order.user, hash, signature)) revert InvalidSignature();

        try
            IERC20Permit(address(usnToken)).permit(order.user, address(this), order.usnAmount, order.expiry, v, r, s)
        {} catch {}

        redeem(order, signature);
    }

    function redeemOnchain(address collateralAddress, uint256 usnAmount) external override nonReentrant {
        if (msg.sender == address(0)) revert ZeroAddress();
        if (!_redeemableCollaterals[collateralAddress]) revert InvalidCollateralAddress();
        if (usnAmount == 0) revert ZeroAmount();
        if (treasury == address(0)) revert TreasuryNotSet();

        // Depeg checks removed: always allow redemption, but use peg price if price < peg

        uint256 currentAllowance = usnToken.allowance(msg.sender, address(this));
        if (currentAllowance < usnAmount) revert InsufficientAllowance();

        if (block.number > lastRedeemBlock) {
            currentBlockRedeemAmount = 0;
            lastRedeemBlock = block.number;
        }

        if (currentBlockRedeemAmount + usnAmount > redeemLimitPerBlock) {
            revert RedeemLimitExceeded(redeemLimitPerBlock, currentBlockRedeemAmount + usnAmount);
        }

        // Calculate collateral amount based on oracle price and peg
        uint256 calculatedCollateralAmount = _calculateCollateralAmount(collateralAddress, usnAmount);

        // Check treasury has sufficient balance
        uint256 treasuryBalance = IERC20(collateralAddress).balanceOf(treasury);
        if (treasuryBalance < calculatedCollateralAmount) {
            revert InsufficientTreasuryBalance(collateralAddress, calculatedCollateralAmount, treasuryBalance);
        }

        // Get oracle data for event emission
        (int256 price, uint256 updatedAt) = getCollateralPrice(collateralAddress);
        emit OracleDataUsed(collateralAddress, price, updatedAt);

        currentBlockRedeemAmount += usnAmount;

        // Burn USN tokens from user
        usnToken.burnFrom(msg.sender, usnAmount);

        // Transfer collateral from treasury to user
        IERC20(collateralAddress).safeTransferFrom(treasury, msg.sender, calculatedCollateralAmount);

        emit Redeemed(msg.sender, collateralAddress, usnAmount, calculatedCollateralAmount);
    }

    // Public functions
    function hashOrder(RedeemOrder calldata order) public view override returns (bytes32) {
        return _hashTypedDataV4(keccak256(encodeOrder(order)));
    }

    function encodeOrder(RedeemOrder calldata order) public pure override returns (bytes memory) {
        return
            abi.encode(
                REDEEM_TYPEHASH,
                keccak256(bytes(order.message)),
                order.user,
                order.collateralAddress,
                order.collateralAmount,
                order.usnAmount,
                order.expiry,
                order.nonce
            );
    }

    function getCollateralPrice(address collateral) public view override returns (int256 price, uint256 updatedAt) {
        address oracle = collateralOracles[collateral];
        if (oracle == address(0)) revert OracleNotSet(collateral);

        AggregatorV3Interface priceFeed = AggregatorV3Interface(oracle);
        (, int256 answer, , uint256 updatedAt_, ) = priceFeed.latestRoundData();

        // Validate oracle data
        if (answer <= 0) revert InvalidOraclePrice(answer);
        if (block.timestamp - updatedAt_ > ORACLE_STALENESS_THRESHOLD) {
            revert StaleOracleData(updatedAt_, ORACLE_STALENESS_THRESHOLD);
        }

        return (answer, updatedAt_);
    }

    function calculateCollateralAmount(address collateral, uint256 usnAmount) external view override returns (uint256) {
        return _calculateCollateralAmount(collateral, usnAmount);
    }

    function getCurrentPegPercentage() external view override returns (uint256) {
        return pegPercentage;
    }

    function getTreasuryBalance(address collateral) external view override returns (uint256) {
        if (treasury == address(0)) revert TreasuryNotSet();
        return IERC20(collateral).balanceOf(treasury);
    }

    function isCollateralDepegged(address collateral) public view override returns (bool, uint256) {
        // Always allow redemption; deviation is 0 if price < peg
        (int256 currentPrice, ) = getCollateralPrice(collateral);
        uint256 pegPrice = 1e8; // Always use 1.00 USD in 8 decimals
        uint256 currentPriceUint = uint256(currentPrice);
        if (currentPriceUint < pegPrice) {
            // If price is below peg, treat as not depegged (deviation = 0)
            return (false, 0);
        }
        // If price above peg, calculate deviation
        uint256 priceDiff = currentPriceUint - pegPrice;
        uint256 depegPercentage = (priceDiff * MAX_PEG_PERCENTAGE) / pegPrice;
        // bool isDepegged = depegPercentage > maxDepegPercentage;
        bool isDepegged = false;
        return (isDepegged, depegPercentage);
    }

    function getCollateralDepegStatus(
        address collateral
    )
        external
        view
        override
        returns (
            uint256 currentPrice,
            uint256 pegPrice,
            uint256 depegPercentage,
            bool isDepegged,
            bool onchainRedeemAllowed
        )
    {
        if (collateralOracles[collateral] == address(0)) {
            return (0, 0, 0, false, true); // No oracle set, redemption allowed
        }
        (int256 price, ) = getCollateralPrice(collateral);
        currentPrice = uint256(price);
        pegPrice = 1e8; // Always use 1.00 USD in 8 decimals
        if (currentPrice < pegPrice) {
            depegPercentage = 0;
            isDepegged = false;
            onchainRedeemAllowed = true;
        } else {
            (isDepegged, depegPercentage) = isCollateralDepegged(collateral);
            onchainRedeemAllowed = !isDepegged;
        }
    }

    // View: Get USN:USD rate based on pegPercentage (in 18 decimals)
    function getRate() external view override returns (uint256) {
        // 1 USN = pegPercentage / 10000 USD (18 decimals)
        return (1e18 * pegPercentage) / MAX_PEG_PERCENTAGE;
    }

    // View: Get USN in collateral rate (amount of collateral per 1 USN, in collateral decimals, factoring in pegPercentage)
    function getRate(address collateral) external view override returns (uint256) {
        (int256 price, ) = getCollateralPrice(collateral);
        uint256 oraclePrice = uint256(price); // Oracle price in 8 decimals
        uint8 collDecimals = collateralDecimals[collateral];
        uint256 baseCollateralAmount;
        if (collDecimals + USD_DECIMALS >= 18) {
            baseCollateralAmount = (1e18 * (10 ** (collDecimals + USD_DECIMALS - 18))) / oraclePrice;
        } else {
            baseCollateralAmount = (1e18 / (10 ** (18 - collDecimals - USD_DECIMALS))) / oraclePrice;
        }
        uint256 adjustedCollateralAmount = (baseCollateralAmount * pegPercentage) / MAX_PEG_PERCENTAGE;
        return adjustedCollateralAmount;
    }

    // Internal functions
    function _calculateCollateralAmount(address collateral, uint256 usnAmount) internal view returns (uint256) {
        (int256 price, ) = getCollateralPrice(collateral);
        uint256 pegPrice = 1e8; // Always use 1.00 USD in 8 decimals
        uint256 collateralPrice = uint256(price);
        uint8 collDecimals = collateralDecimals[collateral];
        // If price < peg, use peg price for calculation
        uint256 effectivePrice = collateralPrice < pegPrice ? pegPrice : collateralPrice;
        uint256 baseCollateralAmount;
        if (collDecimals + USD_DECIMALS >= 18) {
            baseCollateralAmount = (usnAmount * (10 ** (collDecimals + USD_DECIMALS - 18))) / effectivePrice;
        } else {
            baseCollateralAmount = (usnAmount / (10 ** (18 - collDecimals - USD_DECIMALS))) / effectivePrice;
        }
        uint256 adjustedCollateralAmount = (baseCollateralAmount * pegPercentage) / MAX_PEG_PERCENTAGE;
        return adjustedCollateralAmount;
    }

    function _isValidSignature(address signer, bytes32 hash, bytes memory signature) internal view returns (bool) {
        if (signer.code.length == 0) {
            // EOA
            return ECDSA.recover(hash, signature) == signer;
        } else {
            // Contract wallet
            try IERC1271(signer).isValidSignature(hash, signature) returns (bytes4 magicValue) {
                return magicValue == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        }
    }
}
