// SPDX-License-Identifier: MIT
pragma solidity >=0.8.20 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRedeemHandlerV2 {
    // Structs
    struct RedeemOrder {
        string message;
        address user;
        address collateralAddress;
        uint256 collateralAmount;
        uint256 usnAmount;
        uint256 expiry;
        uint256 nonce;
    }

    // Events
    event Redeemed(address indexed from, address indexed collateral, uint256 usnAmount, uint256 collateralAmount);
    event CollateralAdded(address indexed collateral);
    event CollateralRemoved(address indexed collateral);
    event RedeemLimitPerBlockUpdated(uint256 newLimit);
    event CollateralOracleUpdated(address indexed collateral, address indexed oracle);
    event OracleDataUsed(address indexed collateral, int256 price, uint256 updatedAt);
    event PegPercentageUpdated(uint256 newPegPercentage);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event WhitelistedUserAdded(address indexed user);
    event WhitelistedUserRemoved(address indexed user);

    // Custom errors
    error ZeroAddress();
    error CollateralAlreadyAdded();
    error CollateralNotFound();
    error InvalidCollateralAddress();
    error ZeroAmount();
    error SignatureExpired();
    error InvalidSignature();
    error InsufficientAllowance();
    error InvalidNonce();
    error RedeemLimitExceeded(uint256 limit, uint256 attempted);
    error StaleOracleData(uint256 updatedAt, uint256 threshold);
    error InvalidOraclePrice(int256 price);
    error OracleNotSet(address collateral);
    error ZeroOracleAddress();
    error InvalidPegPercentage(uint256 percentage);
    error TreasuryNotSet();
    error InsufficientTreasuryBalance(address collateral, uint256 required, uint256 available);
    error CollateralDepegged(address collateral, uint256 currentPrice, uint256 pegPrice, uint256 depegPercentage);
    error UserNotWhitelisted(address user);
    error UserAlreadyWhitelisted(address user);

    // Functions
    function addRedeemableCollateral(address collateral, address oracle, uint256 pegPrice) external;

    function updateCollateralOracle(address collateral, address oracle) external;

    function removeRedeemableCollateral(address collateral) external;

    function redeemableCollaterals(address collateral) external view returns (bool);

    function setRedeemLimitPerBlock(uint256 _redeemLimitPerBlock) external;

    function setPegPercentage(uint256 _pegPercentage) external;

    function setTreasury(address _treasury) external;

    function redeem(RedeemOrder calldata order, bytes calldata signature) external;

    function redeemWithPermit(
        RedeemOrder calldata order,
        bytes calldata signature,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function redeemOnchain(address collateralAddress, uint256 usnAmount) external;

    function hashOrder(RedeemOrder calldata order) external view returns (bytes32);

    function encodeOrder(RedeemOrder calldata order) external pure returns (bytes memory);

    function getCollateralPrice(address collateral) external view returns (int256 price, uint256 updatedAt);

    function calculateCollateralAmount(address collateral, uint256 usnAmount) external view returns (uint256);

    function getCurrentPegPercentage() external view returns (uint256);

    function getTreasuryBalance(address collateral) external view returns (uint256);

    function isCollateralDepegged(address collateral) external view returns (bool, uint256);

    function getCollateralDepegStatus(
        address collateral
    )
        external
        view
        returns (
            uint256 currentPrice,
            uint256 pegPrice,
            uint256 depegPercentage,
            bool isDepegged,
            bool onchainRedeemAllowed
        );

    function getRate() external view returns (uint256);

    function getRate(address collateral) external view returns (uint256);

    function addWhitelistedUser(address user) external;

    function removeWhitelistedUser(address user) external;

    function isWhitelisted(address user) external view returns (bool);
}
