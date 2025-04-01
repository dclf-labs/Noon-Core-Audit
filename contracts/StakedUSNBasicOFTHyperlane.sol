// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./lzv2-upgradeable/oft-upgradeable/OFTUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IStakedUSNBasicOFTHyperlane.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IMailbox.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IMessageRecipient.sol";

contract StakedUSNBasicOFTHyperlane is
    OFTUpgradeable,
    AccessControlUpgradeable,
    IStakedUSNBasicOFTHyperlane,
    IMessageRecipient
{
    bytes32 public constant BLACKLIST_MANAGER_ROLE = keccak256("BLACKLIST_MANAGER_ROLE");
    mapping(address => bool) public blacklist;

    // Hyperlane storage
    IMailbox public mailbox;
    IInterchainSecurityModule private _interchainSecurityModule;
    mapping(uint32 => bytes32) public remoteTokens;
    bool public hyperlaneEnabled;

    constructor(address _lzEndpoint) OFTUpgradeable(_lzEndpoint) {}

    function initialize(string memory _name, string memory _symbol, address _owner) public initializer {
        __OFT_init(_name, _symbol, _owner);
        __Ownable_init(_owner);
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(BLACKLIST_MANAGER_ROLE, _owner);
    }

    // Setup Hyperlane integration
    function configureHyperlane(address _mailbox) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mailbox = IMailbox(_mailbox);
        hyperlaneEnabled = true;
        emit HyperlaneConfigured(_mailbox);
    }

    function configureISM(address _ism) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _interchainSecurityModule = IInterchainSecurityModule(_ism);
    }

    // Register a remote Hyperlane token contract
    function registerHyperlaneRemoteToken(uint32 _domain, bytes32 _remoteToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_remoteToken != bytes32(0), "Invalid remote token");
        remoteTokens[_domain] = _remoteToken;
        emit RemoteTokenSet(_domain, _remoteToken);
    }

    // Send tokens via Hyperlane
    function sendTokensViaHyperlane(uint32 _destinationDomain, address _recipient, uint256 _amount) external payable {
        if (!hyperlaneEnabled) revert HyperlaneNotEnabled();
        if (_amount == 0) revert InvalidAmount();
        if (_recipient == address(0)) revert InvalidRecipient();
        if (blacklist[_recipient]) revert BlacklistedAddress();

        bytes32 remoteToken = remoteTokens[_destinationDomain];
        if (remoteToken == bytes32(0)) revert RemoteTokenNotRegistered();

        // Burn tokens first
        _burn(msg.sender, _amount);

        // Encode message with recipient and amount
        bytes memory messageBody = abi.encode(_recipient, _amount);

        // Quote dispatch fee
        uint256 requiredFee = mailbox.quoteDispatch(_destinationDomain, remoteToken, messageBody);
        if (msg.value < requiredFee) revert InsufficientInterchainFee();

        // Dispatch message without storing ID
        mailbox.dispatch{ value: msg.value }(_destinationDomain, remoteToken, messageBody);

        emit HyperlaneTransfer(
            _destinationDomain,
            bytes32(uint256(uint160(_recipient))),
            _amount,
            true // isSending = true
        );
    }

    // Handle incoming Hyperlane message
    function handle(uint32 _origin, bytes32 _sender, bytes calldata _message) external payable override onlyMailbox {
        if (!hyperlaneEnabled) revert HyperlaneNotEnabled();

        // Verify sender is registered remote token
        bytes32 expectedToken = remoteTokens[_origin];
        if (_sender != expectedToken) revert InvalidRemoteToken();

        // Decode message
        (address recipient, uint256 amount) = abi.decode(_message, (address, uint256));

        if (recipient == address(0)) revert InvalidRecipient();

        // Mint tokens directly without message ID checking
        _mint(recipient, amount);

        emit HyperlaneTransfer(
            _origin,
            _sender,
            amount,
            false // isSending = false
        );
    }

    // Required by IMessageRecipient interface
    function interchainSecurityModule() external view returns (IInterchainSecurityModule) {
        return _interchainSecurityModule;
    }

    // Modifier to ensure only mailbox can call handle
    modifier onlyMailbox() {
        if (msg.sender != address(mailbox)) revert OnlyMailboxAllowed();
        _;
    }

    // Original functions
    function blacklistAccount(address account) external onlyRole(BLACKLIST_MANAGER_ROLE) {
        blacklist[account] = true;
        emit Blacklisted(account);
    }

    function unblacklistAccount(address account) external onlyRole(BLACKLIST_MANAGER_ROLE) {
        blacklist[account] = false;
        emit Unblacklisted(account);
    }

    function _update(address from, address to, uint256 amount) internal virtual override {
        if (blacklist[from] || blacklist[to]) revert BlacklistedAddress();
        super._update(from, to, amount);
    }

    // Override required functions to resolve conflicts
    function _msgSender() internal view virtual override returns (address) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override returns (bytes calldata) {
        return super._msgData();
    }
}
