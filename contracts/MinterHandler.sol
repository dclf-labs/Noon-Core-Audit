// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./USN.sol";
import "./interfaces/IMinterHandler.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MinterHandler is IMinterHandler, ReentrancyGuard, AccessControl, EIP712 {
    using SafeERC20 for IERC20;

    // Constants
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant WHITELIST_ROLE = keccak256("WHITELIST_ROLE");
    bytes32 private constant ORDER_TYPEHASH =
        keccak256(
            "Order(string message,address user,address collateralAddress,uint256 collateralAmount,uint256 usnAmount,uint256 expiry,uint256 nonce)"
        );

    // State variables
    USN public immutable usnToken;
    address public custodialWallet;
    uint256 public mintLimitPerBlock;
    uint256 public currentBlockMintAmount;
    uint256 public lastMintBlock;

    // Mappings
    mapping(address => bool) public whitelistedUsers;
    mapping(address => bool) public whitelistedCollaterals;
    mapping(address => mapping(uint256 => bool)) private usedNonces;

    // Constructor
    constructor(address _usnToken) EIP712("MinterHandler", "1") {
        if (_usnToken == address(0)) {
            revert ZeroAddress();
        }
        usnToken = USN(_usnToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(WHITELIST_ROLE, msg.sender);
        mintLimitPerBlock = 1000000 * 10 ** 18; // Default limit: 1 million USN
    }

    // External functions
    function setCustodialWallet(address _custodialWallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_custodialWallet == address(0)) {
            revert ZeroAddress();
        }
        custodialWallet = _custodialWallet;
        emit CustodialWalletSet(_custodialWallet);
    }

    function setMintLimitPerBlock(uint256 _mintLimitPerBlock) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintLimitPerBlock = _mintLimitPerBlock;
        emit MintLimitPerBlockUpdated(_mintLimitPerBlock);
    }

    function mint(Order calldata order, bytes calldata signature) external nonReentrant onlyRole(MINTER_ROLE) {
        if (!whitelistedUsers[order.user]) {
            revert UserNotWhitelisted(order.user);
        }
        if (!whitelistedCollaterals[order.collateralAddress]) {
            revert CollateralNotWhitelisted(order.collateralAddress);
        }
        if (block.timestamp > order.expiry) {
            revert SignatureExpired(order.expiry, block.timestamp);
        }
        if (usedNonces[order.user][order.nonce]) {
            revert NonceAlreadyUsed(order.user, order.nonce);
        }
        if ((order.collateralAmount == 0 || order.usnAmount == 0) && order.user != msg.sender) {
            revert ZeroAmount();
        }

        if (order.user != msg.sender) {
            uint256 collateralDecimals = IERC20Metadata(order.collateralAddress).decimals();
            uint256 usnDecimals = usnToken.decimals();

            uint256 normalizedCollateralAmount = order.collateralAmount * 10 ** (18 - collateralDecimals);
            uint256 normalizedUsnAmount = order.usnAmount * 10 ** (18 - usnDecimals);

            uint256 difference;
            if (normalizedCollateralAmount > normalizedUsnAmount) {
                difference = normalizedCollateralAmount - normalizedUsnAmount;
            } else {
                difference = normalizedUsnAmount - normalizedCollateralAmount;
            }

            // Calculate 2% of the larger amount
            uint256 twoPercent = (
                normalizedCollateralAmount > normalizedUsnAmount ? normalizedCollateralAmount : normalizedUsnAmount
            ) / 50;

            if (difference > twoPercent) {
                revert CollateralUsnMismatch(order.collateralAmount, order.usnAmount);
            }
        }

        bytes32 hash = hashOrder(order);

        if (!_isValidSignature(order.user, hash, signature)) {
            revert InvalidSignature();
        }

        if (block.number > lastMintBlock) {
            currentBlockMintAmount = 0;
            lastMintBlock = block.number;
        }

        if (currentBlockMintAmount + order.usnAmount > mintLimitPerBlock) {
            revert MintLimitExceeded(mintLimitPerBlock, currentBlockMintAmount + order.usnAmount);
        }

        usedNonces[order.user][order.nonce] = true;
        usnToken.mint(order.user, order.usnAmount);
        currentBlockMintAmount += order.usnAmount;

        _transferCollateral(order.collateralAddress, order.user, order.collateralAmount);

        emit Mint(order.user, order.collateralAmount, order.usnAmount, order.collateralAddress);
    }

    function addWhitelistedUser(address user) external onlyRole(WHITELIST_ROLE) {
        if (user == address(0)) {
            revert ZeroAddress();
        }
        if (whitelistedUsers[user]) {
            revert UserAlreadyWhitelisted(user);
        }
        whitelistedUsers[user] = true;
        emit WhitelistedUserAdded(user);
    }

    function removeWhitelistedUser(address user) external onlyRole(WHITELIST_ROLE) {
        if (!whitelistedUsers[user]) {
            revert UserNotWhitelisted(user);
        }
        whitelistedUsers[user] = false;
        emit WhitelistedUserRemoved(user);
    }

    function addWhitelistedCollateral(address collateral) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (collateral == address(0)) {
            revert ZeroAddress();
        }
        if (whitelistedCollaterals[collateral]) {
            revert CollateralAlreadyWhitelisted(collateral);
        }
        whitelistedCollaterals[collateral] = true;
        emit WhitelistedCollateralAdded(collateral);
    }

    function removeWhitelistedCollateral(address collateral) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!whitelistedCollaterals[collateral]) {
            revert CollateralNotWhitelisted(collateral);
        }
        whitelistedCollaterals[collateral] = false;
        emit WhitelistedCollateralRemoved(collateral);
    }

    // Public functions
    function hashOrder(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(encodeOrder(order)));
    }

    function encodeOrder(Order calldata order) public pure returns (bytes memory) {
        return
            abi.encode(
                ORDER_TYPEHASH,
                keccak256(bytes(order.message)), // Hashing the message to ensure consistent encoding and fixed length
                order.user,
                order.collateralAddress,
                order.collateralAmount,
                order.usnAmount,
                order.expiry,
                order.nonce
            );
    }

    // Internal functions
    function _transferCollateral(address collateral, address user, uint256 amount) internal {
        IERC20(collateral).safeTransferFrom(user, custodialWallet, amount);
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
