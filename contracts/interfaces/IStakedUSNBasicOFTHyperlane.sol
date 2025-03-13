// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IStakedUSNBasicOFTHyperlane {
    event Blacklisted(address indexed account);
    event Unblacklisted(address indexed account);
    event HyperlaneTransfer(
        uint32 indexed destinationOrOriginDomain,
        bytes32 indexed recipientOrSender,
        uint256 amount,
        bool isSending
    );
    event RemoteTokenSet(uint32 indexed domain, bytes32 indexed remoteToken);
    event HyperlaneConfigured(address mailbox);

    error BlacklistedAddress();
    error HyperlaneNotEnabled();
    error InvalidAmount();
    error InvalidRemoteToken();
    error InvalidRecipient();
    error InsufficientInterchainFee();
    error OnlyMailboxAllowed();
    error RemoteTokenNotRegistered();

    function blacklistAccount(address account) external;

    function unblacklistAccount(address account) external;

    function blacklist(address account) external view returns (bool);
}
