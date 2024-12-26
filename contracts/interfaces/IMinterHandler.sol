// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMinterHandler {
    // Struct
    struct Order {
        string message;
        address user;
        address collateralAddress;
        uint256 collateralAmount;
        uint256 usnAmount;
        uint256 expiry;
        uint256 nonce;
    }
    // Custom errors
    error UserNotWhitelisted(address user);
    error CollateralNotWhitelisted(address collateral);
    error SignatureExpired(uint256 expiry, uint256 currentTimestamp);
    error InvalidSignature();
    error NonceAlreadyUsed(address user, uint256 nonce);
    error MintLimitExceeded(uint256 limit, uint256 attempted);
    error UserAlreadyWhitelisted(address user);
    error CollateralAlreadyWhitelisted(address collateral);
    error ZeroAddress();
    error ZeroAmount();
    error CollateralUsnMismatch(uint256 collateralAmount, uint256 usnAmount);
    error NotAnERC20Token(address addr);
    error InvalidDecimals(address token, uint8 decimals);

    // Events
    event Mint(address indexed user, uint256 collateralAmount, uint256 usnAmount, address indexed collateral);
    event WhitelistedUserAdded(address indexed user);
    event WhitelistedUserRemoved(address indexed user);
    event WhitelistedCollateralAdded(address indexed collateral);
    event WhitelistedCollateralRemoved(address indexed collateral);
    event CustodialWalletSet(address indexed custodialWallet);
    event MintLimitPerBlockUpdated(uint256 newLimit);

    // Functions
    function mint(Order calldata order, bytes calldata signature) external;

    function addWhitelistedUser(address user) external;

    function removeWhitelistedUser(address user) external;

    function addWhitelistedCollateral(address collateral) external;

    function removeWhitelistedCollateral(address collateral) external;

    function setCustodialWallet(address _custodialWallet) external;

    function setMintLimitPerBlock(uint256 _mintLimitPerBlock) external;

    // View functions
    function whitelistedUsers(address user) external view returns (bool);

    function whitelistedCollaterals(address collateral) external view returns (bool);

    function custodialWallet() external view returns (address);

    function mintLimitPerBlock() external view returns (uint256);

    function currentBlockMintAmount() external view returns (uint256);

    function lastMintBlock() external view returns (uint256);

    function hashOrder(Order calldata order) external view returns (bytes32);

    function encodeOrder(Order calldata order) external pure returns (bytes memory);
}
