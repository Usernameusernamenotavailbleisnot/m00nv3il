# m00nv3il Ethereum Testnet Automation Tool

## Overview

The m00nv3il Ethereum Testnet Automation Tool is a comprehensive automation solution designed for interacting with the m00nv3il Ethereum Testnet. This tool automates various blockchain operations including faucet claims, token transfers, smart contract deployment, ERC20 token creation, NFT collection management, and bridging between m00nv3il and Sepolia networks.

## Features

- **Faucet Claims**: Automated token claiming from the m00nv3il testnet faucet
- **Token Transfers**: Self-transfers to keep wallets active and test transaction functionalities
- **Smart Contract Deployment**: Deploy and interact with sample smart contracts
- **ERC20 Token Management**: Create, deploy, mint, and burn custom ERC20 tokens
- **NFT Collection Management**: Create NFT collections, mint NFTs with metadata, and burn tokens
- **Bridge Operations**: Bridge tokens between m00nv3il and Sepolia networks
- **Proxy Support**: Rotate through HTTP proxies for distributed operations
- **Gas Price Optimization**: Automatic gas price calculation with retry mechanisms
- **Detailed Logging**: Comprehensive color-coded console output for tracking operations
- **Balance Checking**: Waits for faucet funds to be credited before continuing with operations

## Requirements

- Node.js 14.x or higher
- NPM 6.x or higher
- Private keys for the wallets you want to automate
- Optional: HTTP proxies for distributed operations

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Usernameusernamenotavailbleisnot/m00nv3il.git
   cd m00nv3il
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Add your private keys to `pk.txt`, one per line:
   ```
   0x1234567890abcdef...
   0x9876543210abcdef...
   ```

4. Optional: Add HTTP proxies to `proxy.txt`, one per line:
   ```
   http://username:password@ip:port
   http://username:password@ip:port
   ```

5. Configure the tool by editing `config.json` (see Configuration section below)

## Configuration

The tool is configured through the `config.json` file. Here's an explanation of the main configuration options:

```json
{
  "enable_faucet": true,          // Enable/disable faucet claiming
  "enable_transfer": true,        // Enable/disable token transfers
  "enable_contract_deploy": true, // Enable/disable smart contract deployment
  "enable_bridge": true,          // Enable/disable bridging operations
  "bridge": {
    "to_sepolia": {               // m00nv3il to Sepolia bridge settings
      "enabled": true,            // Enable/disable this direction
      "amount": {
        "min": "0.00001",         // Minimum amount to bridge
        "max": "0.0001"           // Maximum amount to bridge
      },
      "count": {                  // Number of bridge operations to perform
        "min": 1,
        "max": 3
      }
    },
    "to_m00nv3il": {              // Sepolia to m00nv3il bridge settings
      "enabled": false,           // Enable/disable this direction
      "amount": {
        "min": "0.00001",         // Minimum amount to bridge
        "max": "0.0001"           // Maximum amount to bridge
      },
      "count": {                  // Number of bridge operations to perform
        "min": 1,
        "max": 3
      }
    }
  },
  "gas_price_multiplier": 1.2,    // Gas price multiplier for faster confirmations
  "max_retries": 5,               // Maximum retry attempts for failed operations
  "base_wait_time": 10,           // Base wait time between retries (seconds)
  "transfer_amount_percentage": 90, // Percentage of balance to transfer in self-transfers

  "contract": {
    "contract_interactions": {
      "enabled": true,            // Enable/disable contract interactions after deployment
      "count": {                  // Number of interactions to perform
        "min": 3,
        "max": 8
      },
      "types": ["setValue", "increment", "decrement", "reset", "contribute"]  // Available interaction types
    }
  },

  "erc20": {
    "enable_erc20": true,         // Enable/disable ERC20 token operations
    "mint_amount": {              // Range for token minting amounts
      "min": 1000000,
      "max": 10000000
    },
    "burn_percentage": 10,        // Percentage of tokens to burn after minting
    "decimals": 18                // Number of decimals for the ERC20 token
  },

  "nft": {
    "enable_nft": true,           // Enable/disable NFT collection operations
    "mint_count": {               // Number of NFTs to mint per collection
      "min": 2,
      "max": 5
    },
    "burn_percentage": 20,        // Percentage of NFTs to burn after minting
    "supply": {                   // Range for NFT collection total supply
      "min": 100,
      "max": 500
    }
  }
}
```

## Bridge Information

- **Contract Address**: 0x528e26b25a34a4A5d0dbDa1d57D318153d2ED582
- **Bridgeable Networks**: m00nv3il ⟷ Sepolia

## Usage

To start the automation tool:

```bash
npm start
```

The tool will process each wallet from the `pk.txt` file, performing the enabled operations in sequence:

1. Claiming tokens from the m00nv3il testnet faucet
2. Waiting for faucet funds to be credited (if successful claim)
3. Performing token self-transfers
4. Bridging tokens between m00nv3il and Sepolia networks
5. Deploying and interacting with smart contracts
6. Creating, minting, and burning ERC20 tokens
7. Creating NFT collections, minting NFTs, and burning tokens

After processing all wallets, the tool will wait for 8 hours before starting the next cycle.

## File Structure

```
m00nv3il-testnet-automation/
├── index.js              # Main entry point
├── config.json           # Configuration file
├── pk.txt                # Private keys (one per line)
├── proxy.txt             # Proxies (one per line)
├── package.json          # Node.js dependencies
├── utils/
│   └── constants.js      # Constants and templates
└── src/
    ├── faucet.js         # Faucet claims functionality
    ├── transfer.js       # Token transfer functionality
    ├── bridge.js         # Bridge functionality between networks
    ├── ContractDeployer.js   # Smart contract deployment
    ├── ERC20TokenDeployer.js # ERC20 token operations
    └── NFTManager.js     # NFT collection management
```

## How It Works

The tool is modular and each operation is handled by a specialized class:

- **FaucetClaimer**: Claims tokens from the m00nv3il faucet
- **TokenTransfer**: Handles token self-transfers
- **BridgeManager**: Manages bridging tokens between m00nv3il and Sepolia networks
- **ContractDeployer**: Compiles and deploys smart contracts, then interacts with them
- **ERC20TokenDeployer**: Creates, deploys, mints, and burns ERC20 tokens
- **NFTManager**: Creates, deploys, mints, and burns NFT collections

All operations include:
- Proper nonce management to prevent transaction failures
- Gas price optimization for faster confirmations
- Exponential backoff retry mechanisms for failed operations
- Detailed logging with timestamp and wallet identification

### Common Issues

1. **Faucet Claims Failing**:
   - Check if you're rate limited (the tool will detect and report this)
   - Verify your IP isn't blocked (try using proxies)

2. **Transaction Errors**:
   - Ensure your wallet has sufficient funds
   - Check if the gas price is appropriate (adjust `gas_price_multiplier`)
   - Increase `max_retries` if network is congested

3. **Bridge Operations Failing**:
   - Verify you have enough balance in the source network
   - Check if the contract address is correct
   - Ensure you're using the correct network IDs

4. **Contract Deployment Failures**:
   - Ensure the Solidity version is compatible with the network
   - Check for compilation errors in the logs
   - Verify the contract size isn't too large

### Logs

The tool provides detailed color-coded console output:
- 🟢 Green: Successful operations
- 🔴 Red: Errors
- 🟡 Yellow: Warnings/Notices
- 🔵 Blue: Operation headings
- 🔷 Cyan: Informational messages

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This tool is for educational and testing purposes only. Use it responsibly and in accordance with the terms of service of the m00nv3il Ethereum Testnet.
