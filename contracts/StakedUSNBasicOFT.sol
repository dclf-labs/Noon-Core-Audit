// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./lzv2-upgradeable/oft-upgradeable/OFTUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IStakedUSNBasicOFT.sol";

contract StakedUSNBasicOFT is OFTUpgradeable, AccessControlUpgradeable, IStakedUSNBasicOFT {
    bytes32 public constant BLACKLIST_MANAGER_ROLE = keccak256("BLACKLIST_MANAGER_ROLE");

    mapping(address => bool) public blacklist;

    constructor(address _lzEndpoint) OFTUpgradeable(_lzEndpoint) {}

    function initialize(
        string memory _name,
        string memory _symbol,
        address _owner
    ) public initializer {
        __OFT_init(_name, _symbol, _owner);
        __Ownable_init(_owner);
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(BLACKLIST_MANAGER_ROLE, _owner);
    }

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
