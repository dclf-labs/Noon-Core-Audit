// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@hyperlane-xyz/core/contracts/interfaces/IMessageRecipient.sol";
import "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import "@hyperlane-xyz/core/contracts/interfaces/hooks/IPostDispatchHook.sol";

contract MockMailbox {
    uint32 public immutable localDomain;
    mapping(uint32 => bytes32) public remoteMailboxes;
    mapping(bytes32 => bool) public processedMessages;
    uint256 public mockFee = 0.001 ether;
    bytes32 public latestDispatchedId_;

    IInterchainSecurityModule private defaultIsm_;
    IPostDispatchHook private defaultHook_;
    IPostDispatchHook private requiredHook_;

    constructor(uint32 _localDomain) {
        localDomain = _localDomain;
    }

    function setRemoteMailbox(uint32 _domain, address _mailbox) external {
        remoteMailboxes[_domain] = bytes32(uint256(uint160(_mailbox)));
    }

    function dispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody
    ) external payable returns (bytes32) {
        return _dispatch(_destinationDomain, _recipientAddress, _messageBody);
    }

    function dispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        bytes calldata /*_hookMetadata*/
    ) external payable returns (bytes32) {
        return _dispatch(_destinationDomain, _recipientAddress, _messageBody);
    }

    function dispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        uint256 /*_gasAmount*/,
        uint256 /*_gasPayment*/,
        address /*_refundAddress*/
    ) external payable returns (bytes32) {
        return _dispatch(_destinationDomain, _recipientAddress, _messageBody);
    }

    function dispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        uint256 /*_gasAmount*/,
        uint256 /*_gasPayment*/,
        address /*_refundAddress*/,
        bytes calldata /*_hookMetadata*/
    ) external payable returns (bytes32) {
        return _dispatch(_destinationDomain, _recipientAddress, _messageBody);
    }

    function dispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        uint256 _gasAmount,
        uint256 _gasPayment,
        address _refundAddress,
        bytes calldata _hookMetadata,
        bytes calldata _processingHookMetadata
    ) external payable returns (bytes32) {
        return _dispatch(_destinationDomain, _recipientAddress, _messageBody);
    }

    function _dispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody
    ) internal returns (bytes32) {
        require(msg.value >= mockFee, "Insufficient fee");

        bytes32 messageId = keccak256(
            abi.encodePacked(localDomain, _destinationDomain, msg.sender, _recipientAddress, _messageBody)
        );

        // Get the remote mailbox address
        bytes32 remoteMailbox = remoteMailboxes[_destinationDomain];
        require(remoteMailbox != bytes32(0), "Remote mailbox not configured");

        // Convert recipient address from bytes32 to address
        address recipient = address(uint160(uint256(_recipientAddress)));

        // Call handle on the recipient directly
        IMessageRecipient(recipient).handle(localDomain, bytes32(uint256(uint160(msg.sender))), _messageBody);

        processedMessages[messageId] = true;
        latestDispatchedId_ = messageId;

        return messageId;
    }

    function process(bytes calldata _metadata, bytes calldata _message) external payable returns (bytes32) {
        return bytes32(0);
    }

    function count() external view returns (uint32) {
        return 0;
    }

    function root() external view returns (bytes32) {
        return bytes32(0);
    }

    function latestCheckpoint() external view returns (bytes32, uint32) {
        return (bytes32(0), 0);
    }

    function defaultIsm() external view returns (IInterchainSecurityModule) {
        return defaultIsm_;
    }

    function defaultHook() external view returns (IPostDispatchHook) {
        return defaultHook_;
    }

    function requiredHook() external view returns (IPostDispatchHook) {
        return requiredHook_;
    }

    function latestDispatchedId() external view returns (bytes32) {
        return latestDispatchedId_;
    }

    function recipientIsm(
        bytes32 _messageId,
        bytes calldata _message
    ) external view returns (IInterchainSecurityModule) {
        return defaultIsm_;
    }

    function delivered(bytes32 _messageId) external view returns (bool) {
        return processedMessages[_messageId];
    }

    function quoteDispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody
    ) external view returns (uint256) {
        return mockFee;
    }

    function quoteDispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        bytes calldata /*_hookMetadata*/
    ) external view returns (uint256) {
        return mockFee;
    }

    function quoteDispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        uint256 /*_gasAmount*/
    ) external view returns (uint256) {
        return mockFee;
    }

    function quoteDispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        uint256 /*_gasAmount*/,
        bytes calldata /*_hookMetadata*/
    ) external view returns (uint256) {
        return mockFee;
    }

    function quoteDispatch(
        uint32 _destinationDomain,
        bytes32 _recipientAddress,
        bytes calldata _messageBody,
        uint256 _gasAmount,
        bytes calldata _hookMetadata,
        bytes calldata _processingHookMetadata
    ) external view returns (uint256) {
        return mockFee;
    }

    function quoteDispatch(bytes calldata _metadata, bytes calldata _message) external view returns (uint256) {
        return mockFee;
    }

    // Mock configuration functions
    function setMockFee(uint256 _fee) external {
        mockFee = _fee;
    }

    function setDefaultIsm(IInterchainSecurityModule _ism) external {
        defaultIsm_ = _ism;
    }

    function setDefaultHook(IPostDispatchHook _hook) external {
        defaultHook_ = _hook;
    }

    function setRequiredHook(IPostDispatchHook _hook) external {
        requiredHook_ = _hook;
    }

    function processMessage(uint32 _origin, bytes32 _sender, address _recipient, bytes calldata _body) external {
        bytes32 messageId = keccak256(abi.encodePacked(_origin, _sender, _recipient, _body));
        require(!processedMessages[messageId], "Message already processed");

        processedMessages[messageId] = true;
        IMessageRecipient(_recipient).handle(_origin, _sender, _body);
    }
}
