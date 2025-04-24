// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.24;

import "./interfaces/IRateProvider.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RateProvider is IRateProvider {
    address public immutable susn;
    address public immutable usn;

    uint8 public immutable decimals = 18;

    constructor(address _susn, address _usn) {
        require(_susn != address(0), "Invalid SUSN address");
        require(_usn != address(0), "Invalid USN address");
        susn = _susn;
        usn = _usn;
    }

    /// @inheritdoc IRateProvider
    function getRate() external view returns (uint256 rate) {
        uint256 usnBalance = IERC20(usn).balanceOf(susn);
        uint256 susnSupply = IERC20(susn).totalSupply();
        require(susnSupply > 0, "SUSN supply is zero");
        return (usnBalance * 1e18) / susnSupply;
    }
}
