const { Web3 } = require('web3');
const chalk = require('chalk');
const constants = require('../utils/constants');

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

class BridgeManager {
    constructor(config = {}) {
        // Default configuration
        this.defaultConfig = {
            enable_bridge: true,
            gas_price_multiplier: constants.GAS.PRICE_MULTIPLIER,
            bridge: {
                to_sepolia: {
                    enabled: true,
                    amount: {
                        min: constants.BRIDGE.MIN_AMOUNT,
                        max: constants.BRIDGE.MIN_AMOUNT
                    },
                    count: {
                        min: 1,
                        max: 1
                    }
                },
                to_moonveil: {
                    enabled: false,
                    amount: {
                        min: constants.BRIDGE.MIN_AMOUNT,
                        max: constants.BRIDGE.MIN_AMOUNT
                    },
                    count: {
                        min: 1,
                        max: 1
                    }
                }
            }
        };
        
        // Load configuration, merging with defaults
        this.config = { ...this.defaultConfig };
        
        // Merge bridge config properly to preserve nested structure
        if (config.bridge) {
            this.config.bridge = {
                to_sepolia: { 
                    ...this.defaultConfig.bridge.to_sepolia,
                    ...config.bridge.to_sepolia
                },
                to_moonveil: {
                    ...this.defaultConfig.bridge.to_moonveil,
                    ...config.bridge.to_moonveil
                }
            };
        }
        
        // Other config options
        if (config.enable_bridge !== undefined) this.config.enable_bridge = config.enable_bridge;
        if (config.gas_price_multiplier !== undefined) this.config.gas_price_multiplier = config.gas_price_multiplier;
        
        // Setup web3 connections for both networks
        this.web3Moonveil = new Web3(constants.NETWORK.RPC_URL);
        this.web3Sepolia = new Web3("https://rpc.ankr.com/eth_sepolia");
        
        this.walletNum = null;
        
        // Add nonce tracking to avoid transaction issues
        this.currentMoonveilNonce = null;
        this.currentSepoliaNonce = null;
    }
    
    setWalletNum(num) {
        this.walletNum = num;
    }
    
    // Get account from private key for either network
    getAccount(privateKey, network = "moonveil") {
        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            
            const web3 = network === "moonveil" ? this.web3Moonveil : this.web3Sepolia;
            return web3.eth.accounts.privateKeyToAccount(privateKey);
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Error creating account for ${network}: ${error.message}`));
            return null;
        }
    }
    
    // Get the next nonce for the specified network
    async getNonce(address, network = "moonveil") {
        const web3 = network === "moonveil" ? this.web3Moonveil : this.web3Sepolia;
        const nonceRef = network === "moonveil" ? this.currentMoonveilNonce : this.currentSepoliaNonce;
        
        if (nonceRef === null) {
            // If this is the first transaction, get the nonce from the network
            const networkNonce = await web3.eth.getTransactionCount(address);
            if (network === "moonveil") {
                this.currentMoonveilNonce = networkNonce;
            } else {
                this.currentSepoliaNonce = networkNonce;
            }
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Initial ${network} nonce from network: ${networkNonce}`));
            return networkNonce;
        } else {
            // For subsequent transactions, use the tracked nonce
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Using tracked ${network} nonce: ${nonceRef}`));
            return nonceRef;
        }
    }
    
    // Update nonce after a transaction is sent
    incrementNonce(network = "moonveil") {
        if (network === "moonveil" && this.currentMoonveilNonce !== null) {
            this.currentMoonveilNonce++;
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Incremented ${network} nonce to: ${this.currentMoonveilNonce}`));
        } else if (network === "sepolia" && this.currentSepoliaNonce !== null) {
            this.currentSepoliaNonce++;
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Incremented ${network} nonce to: ${this.currentSepoliaNonce}`));
        }
    }
    
    // Enhanced gas price calculation with retries
    async getGasPrice(network = "moonveil", retryCount = 0) {
        try {
            const web3 = network === "moonveil" ? this.web3Moonveil : this.web3Sepolia;
            
            // Get the current gas price from the network
            const networkGasPrice = await web3.eth.getGasPrice();
            
            // Apply base multiplier from config
            let multiplier = this.config.gas_price_multiplier || constants.GAS.PRICE_MULTIPLIER;
            
            // Apply additional multiplier for retries
            if (retryCount > 0) {
                const retryMultiplier = Math.pow(constants.GAS.RETRY_INCREASE, retryCount);
                multiplier *= retryMultiplier;
                console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Applying retry multiplier: ${retryMultiplier.toFixed(2)}x (total: ${multiplier.toFixed(2)}x)`));
            }
            
            // Calculate gas price with multiplier
            const adjustedGasPrice = BigInt(Math.floor(Number(networkGasPrice) * multiplier));
            
            // Convert to gwei for display
            const gweiPrice = web3.utils.fromWei(adjustedGasPrice.toString(), 'gwei');
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ ${network} gas price: ${web3.utils.fromWei(networkGasPrice, 'gwei')} gwei, using: ${gweiPrice} gwei (${multiplier.toFixed(2)}x)`));
            
            // Enforce min/max gas price in gwei
            const minGasPrice = BigInt(web3.utils.toWei(constants.GAS.MIN_GWEI.toString(), 'gwei'));
            const maxGasPrice = BigInt(web3.utils.toWei(constants.GAS.MAX_GWEI.toString(), 'gwei'));
            
            // Ensure gas price is within bounds
            let finalGasPrice = adjustedGasPrice;
            if (adjustedGasPrice < minGasPrice) {
                finalGasPrice = minGasPrice;
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas price below minimum, using: ${constants.GAS.MIN_GWEI} gwei`));
            } else if (adjustedGasPrice > maxGasPrice) {
                finalGasPrice = maxGasPrice;
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas price above maximum, using: ${constants.GAS.MAX_GWEI} gwei`));
            }
            
            return finalGasPrice.toString();
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Error getting ${network} gas price: ${error.message}`));
            
            // Fallback to a low gas price
            const web3 = network === "moonveil" ? this.web3Moonveil : this.web3Sepolia;
            const fallbackGasPrice = web3.utils.toWei(constants.GAS.MIN_GWEI.toString(), 'gwei');
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Using fallback gas price: ${constants.GAS.MIN_GWEI} gwei`));
            
            return fallbackGasPrice;
        }
    }
    
    // Improved gas estimation with buffer
    async estimateGas(txObject, network = "moonveil") {
        try {
            const web3 = network === "moonveil" ? this.web3Moonveil : this.web3Sepolia;
            
            // Get the gas estimate from the blockchain
            const estimatedGas = await web3.eth.estimateGas(txObject);
            
            // Add 20% buffer for safety
            const gasWithBuffer = Math.floor(Number(estimatedGas) * 1.2);
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Estimated gas for ${network}: ${estimatedGas}, with buffer: ${gasWithBuffer}`));
            
            return gasWithBuffer;
        } catch (error) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Gas estimation failed for ${network}: ${error.message}`));
            
            // Use hardcoded gas values based on the examples
            let defaultGas;
            if (network === "moonveil") {
                defaultGas = 194919; // Taken from the example tx for Moonveil
            } else {
                defaultGas = 327633; // Taken from the example tx for Sepolia
            }
            
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Using example gas limit: ${defaultGas}`));
            return defaultGas;
        }
    }
    
    async executeBridgeOperation(privateKey, options = {}) {
        // Merge options with defaults
        const opts = { ...{ targetNetwork: this.config.target_network }, ...options };
        
        // Determine source and target networks based on the targetNetwork option
        const sourceNetwork = opts.targetNetwork === "sepolia" ? "moonveil" : "sepolia";
        const targetNetwork = opts.targetNetwork;
        
        // Get chain IDs based on networks
        const sourceChainId = sourceNetwork === "moonveil" ? 
            constants.BRIDGE.MOONVEIL_CHAIN_ID : constants.BRIDGE.SEPOLIA_CHAIN_ID;
            
        // Get target network ID based on direction - this is critical for the bridge to work
        // Moonveil → Sepolia: Use destination network ID = 0
        // Sepolia → Moonveil: Use destination network ID = 22 (0x16)
        const targetNetworkId = targetNetwork === "sepolia" ? 0 : 22;
        
        console.log(chalk.blue.bold(`${getTimestamp(this.walletNum)} Initiating bridge from ${sourceNetwork} to ${targetNetwork}...`));
        
        try {
            // Create account for the source network
            const account = this.getAccount(privateKey, sourceNetwork);
            if (!account) {
                throw new Error(`Failed to create account for ${sourceNetwork}`);
            }
            
            // Get web3 instance for the source network
            const web3 = sourceNetwork === "moonveil" ? this.web3Moonveil : this.web3Sepolia;
            
            // Check balance
            const balance = BigInt(await web3.eth.getBalance(account.address));
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ ${sourceNetwork} balance: ${web3.utils.fromWei(balance.toString(), 'ether')}`));
            
            // Calculate bridge amount (default to MIN_AMOUNT if not specified)
            const bridgeAmountEth = opts.amount || constants.BRIDGE.MIN_AMOUNT;
            const bridgeAmount = web3.utils.toWei(bridgeAmountEth, 'ether');
            
            // Get necessary transaction parameters
            const nonce = await this.getNonce(account.address, sourceNetwork);
            const gasPrice = await this.getGasPrice(sourceNetwork);
            
            // Create the bridge transaction data based on the examples from the paste.txt
            // Function signature 0xcd586579 followed by correctly padded parameters
            // We'll use the exact format shown in the examples instead of abi.encodeFunctionCall
            
            // Convert destination network ID to hex, padded to 32 bytes
            const destinationNetworkHex = web3.utils.padLeft(
                web3.utils.numberToHex(targetNetworkId), 
                64
            ).replace('0x', '');
            
            // Convert destination address to hex, padded to 32 bytes
            const destinationAddressHex = web3.utils.padLeft(
                account.address.toLowerCase().replace('0x', ''), 
                64
            );
            
            // Convert bridge amount to hex, padded to 32 bytes
            const amountHex = web3.utils.padLeft(
                web3.utils.numberToHex(bridgeAmount), 
                64
            ).replace('0x', '');
            
            // Token address (zero address for native token), padded to 32 bytes
            const tokenAddressHex = '0000000000000000000000000000000000000000000000000000000000000000';
            
            // ForceUpdateGlobalExitRoot flag (true), padded to 32 bytes
            const forceUpdateHex = '0000000000000000000000000000000000000000000000000000000000000001';
            
            // Location of the empty bytes array, padded to 32 bytes
            const bytesLocationHex = '00000000000000000000000000000000000000000000000000000000000000c0';
            
            // Length of the empty bytes array, padded to 32 bytes
            const bytesLengthHex = '0000000000000000000000000000000000000000000000000000000000000000';
            
            // Combine all parts
            const bridgeData = '0xcd586579' + 
                destinationNetworkHex +
                destinationAddressHex +
                amountHex +
                tokenAddressHex +
                forceUpdateHex +
                bytesLocationHex +
                bytesLengthHex;
            
            // Create transaction template for gas estimation
            const txTemplate = {
                from: account.address,
                to: constants.BRIDGE.CONTRACT_ADDRESS,
                data: bridgeData,
                value: bridgeAmount,
                nonce: nonce,
                chainId: sourceChainId
            };
            
            // Estimate gas
            const gasLimit = await this.estimateGas(txTemplate, sourceNetwork);
            
            // Create complete transaction
            const tx = {
                ...txTemplate,
                gas: gasLimit,
                gasPrice: gasPrice
            };
            
            // Sign the transaction
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Signing bridge transaction on ${sourceNetwork}...`));
            const signedTx = await web3.eth.accounts.signTransaction(tx, account.privateKey);
            
            // Increment nonce before sending
            this.incrementNonce(sourceNetwork);
            
            // Send the transaction
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Sending bridge transaction...`));
            const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            
            const explorerUrl = sourceNetwork === "moonveil" ? 
                constants.NETWORK.EXPLORER_URL : "https://sepolia.etherscan.io";
            
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Bridge transaction sent successfully!`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Amount: ${bridgeAmountEth} ${sourceNetwork === "moonveil" ? "MORE" : "ETH"}`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ Transaction hash: ${receipt.transactionHash}`));
            console.log(chalk.green(`${getTimestamp(this.walletNum)} ✓ View transaction: ${explorerUrl}/tx/${receipt.transactionHash}`));
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Bridge transactions typically take 10-30 minutes to complete`));
            
            return true;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.walletNum)} ✗ Bridge error: ${error.message}`));
            return false;
        }
    }
    
    // Get random amount within range
    getRandomAmount(min, max) {
        // Convert to wei/gwei numbers for precision
        const minWei = parseFloat(min);
        const maxWei = parseFloat(max);
        const randomAmount = minWei + (Math.random() * (maxWei - minWei));
        
        // Format to 8 decimal places max
        return randomAmount.toFixed(8);
    }
    
    // Execute multiple bridge operations based on count and direction
    async executeMultipleBridgeOperations(privateKey, direction) {
        const directionConfig = direction === "to_sepolia" ? 
            this.config.bridge.to_sepolia : this.config.bridge.to_moonveil;
        
        if (!directionConfig.enabled) {
            console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Bridge ${direction} is disabled in config`));
            return false;
        }
        
        // Determine count of operations
        const minCount = Math.max(1, directionConfig.count?.min || 1);
        const maxCount = Math.max(minCount, directionConfig.count?.max || 1);
        const operationCount = Math.floor(Math.random() * (maxCount - minCount + 1)) + minCount;
        
        console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Will perform ${operationCount} bridge operations ${direction}`));
        
        let successCount = 0;
        for (let i = 0; i < operationCount; i++) {
            // Get random amount within range
            const minAmount = directionConfig.amount?.min || constants.BRIDGE.MIN_AMOUNT;
            const maxAmount = directionConfig.amount?.max || minAmount;
            const amount = this.getRandomAmount(minAmount, maxAmount);
            
            console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Bridge operation ${i+1}/${operationCount}: ${amount} ${direction === "to_sepolia" ? "MORE" : "ETH"}`));
            
            const success = await this.executeBridgeOperation(privateKey, {
                targetNetwork: direction === "to_sepolia" ? "sepolia" : "moonveil",
                amount: amount
            });
            
            if (success) {
                successCount++;
            }
            
            // Small delay between operations if more than one
            if (i < operationCount - 1) {
                const waitTime = Math.floor(Math.random() * 5) + 3; // 3-7 seconds
                console.log(chalk.yellow(`${getTimestamp(this.walletNum)} ⚠ Waiting ${waitTime} seconds before next bridge operation...`));
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
        }
        
        console.log(chalk.cyan(`${getTimestamp(this.walletNum)} ℹ Completed ${successCount}/${operationCount} bridge operations ${direction}`));
        return successCount > 0;
    }
    
    // Bridge from Moonveil to Sepolia
    async bridgeToSepolia(privateKey) {
        return this.executeMultipleBridgeOperations(privateKey, "to_sepolia");
    }
    
    // Bridge from Sepolia to Moonveil
    async bridgeToMoonveil(privateKey) {
        return this.executeMultipleBridgeOperations(privateKey, "to_moonveil");
    }
}

module.exports = BridgeManager;