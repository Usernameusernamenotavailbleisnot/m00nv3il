const fs = require('fs').promises;
const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const crypto = require('crypto');
const _ = require('lodash');
const { Web3 } = require('web3'); // Add Web3 import

// Import modules
const FaucetClaimer = require('./src/faucet');
const TokenTransfer = require('./src/transfer');
const ContractDeployer = require('./src/ContractDeployer');
const ERC20TokenDeployer = require('./src/ERC20TokenDeployer');
const NFTManager = require('./src/NFTManager');
const BridgeManager = require('./src/Bridge');
const constants = require('./utils/constants');

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't crash the process
});

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

// Load configuration from JSON
async function loadConfig() {
    try {
        const jsonExists = await fs.access('config.json').then(() => true).catch(() => false);
        if (jsonExists) {
            console.log(chalk.green(`${getTimestamp()} ✓ Found config.json`));
            const jsonContent = await fs.readFile('config.json', 'utf8');
            return JSON.parse(jsonContent);
        }
        
        console.log(chalk.yellow(`${getTimestamp()} ⚠ No configuration file found, using defaults`));
        // Return a default configuration
        return {
            enable_faucet: true,
            enable_transfer: true,
            enable_contract_deploy: true,
            enable_bridge: true,
            bridge: {
                direction: "to_sepolia", // "to_sepolia" or "to_moonveil"
                amount: "0.00001" // Amount to bridge
            },
            erc20: { enable_erc20: true },
            nft: { enable_nft: true },
            gas_price_multiplier: constants.GAS.PRICE_MULTIPLIER,
            max_retries: constants.RETRY.MAX_RETRIES,
            base_wait_time: constants.RETRY.BASE_WAIT_TIME,
            transfer_amount_percentage: constants.TRANSFER.AMOUNT_PERCENTAGE
        };
    } catch (error) {
        console.log(chalk.red(`${getTimestamp()} ✗ Error loading configuration: ${error.message}`));
        return {
            enable_faucet: true,
            enable_transfer: true,
            enable_contract_deploy: true,
            enable_bridge: true,
            bridge: {
                to_sepolia: {
                    enabled: true,
                    amount: {
                        min: "0.00001",
                        max: "0.0001"
                    },
                    count: {
                        min: 1,
                        max: 3
                    }
                },
                to_moonveil: {
                    enabled: false,
                    amount: {
                        min: "0.00001",
                        max: "0.0001"
                    },
                    count: {
                        min: 1,
                        max: 3
                    }
                }
            },
            erc20: { enable_erc20: true },
            nft: { enable_nft: true },
            gas_price_multiplier: constants.GAS.PRICE_MULTIPLIER,
            max_retries: constants.RETRY.MAX_RETRIES,
            base_wait_time: constants.RETRY.BASE_WAIT_TIME,
            transfer_amount_percentage: constants.TRANSFER.AMOUNT_PERCENTAGE
        };
    }
}

// Load proxies from file
async function loadProxies() {
    try {
        const proxyFile = await fs.readFile('proxy.txt', 'utf8');
        const proxies = proxyFile.split('\n').map(line => line.trim()).filter(line => line);
        console.log(chalk.green(`${getTimestamp()} ✓ Successfully loaded ${proxies.length} proxies`));
        return proxies;
    } catch (error) {
        console.log(chalk.yellow(`${getTimestamp()} ⚠ proxy.txt not found, will not use proxies`));
        return [];
    }
}

// Countdown timer for waiting between batches
async function countdownTimer(hours = 25) {
    const totalSeconds = hours * 3600;
    let remainingSeconds = totalSeconds;

    while (remainingSeconds > 0) {
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;

        // Clear previous line and update countdown
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
            chalk.blue(`${getTimestamp()} Next cycle in: `) + 
            chalk.yellow(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`)
        );

        await new Promise(resolve => setTimeout(resolve, 1000));
        remainingSeconds--;
    }

    // Clear the countdown line
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.log(chalk.green(`${getTimestamp()} ✓ Countdown completed!`));
}

async function main() {
    while (true) {
        console.log(chalk.blue.bold('\n=== Moonveil Testnet Automation Tool ===\n'));

        try {
            // Load configuration
            const config = await loadConfig();
            console.log(chalk.green(`${getTimestamp()} ✓ Configuration loaded`));
            
            // Load proxies
            const proxies = await loadProxies();
            
            // Load private keys
            const privateKeys = (await fs.readFile('pk.txt', 'utf8'))
                .split('\n')
                .map(line => line.trim())
                .filter(line => line);

            console.log(chalk.green(`${getTimestamp()} ✓ Found ${privateKeys.length} private keys`));

            console.log(chalk.blue.bold(`${getTimestamp()} Initializing automation...`));

            // Create instances of our modules
            const faucetClaimer = new FaucetClaimer(config, proxies);
            const tokenTransfer = new TokenTransfer(config);
            const bridgeManager = new BridgeManager(config);

            // Process wallets
            console.log(chalk.blue.bold(`\nProcessing ${privateKeys.length} wallets...\n`));

            for (let i = 0; i < privateKeys.length; i++) {
                const walletNum = i + 1;
                const pk = privateKeys[i];

                console.log(chalk.blue.bold(`\n=== Processing Wallet ${walletNum}/${privateKeys.length} ===\n`));

                // Get random proxy if available
                const proxy = proxies.length > 0 ? 
                    proxies[Math.floor(Math.random() * proxies.length)] : null;
                
                if (proxy) {
                    console.log(chalk.cyan(`${getTimestamp(walletNum)} ℹ Using proxy: ${proxy}`));
                }

                // 1. Claim faucet tokens if enabled
                if (config.enable_faucet) {
                    let claimResult = { success: false, rateLimited: false };
                    let attempt = 0;
                    
                    while (!claimResult.success && attempt < config.max_retries) {
                        console.log(chalk.blue.bold(`${getTimestamp(walletNum)} Claiming tokens from faucet... (Attempt ${attempt + 1}/${config.max_retries})`));
                        claimResult = await faucetClaimer.claimFaucet(pk, walletNum);
                        
                        if (!claimResult.success) {
                            attempt++;
                            if (attempt < config.max_retries) {
                                const waitTime = Math.min(300, config.base_wait_time * (2 ** attempt));
                                console.log(chalk.yellow(`${getTimestamp(walletNum)} Waiting ${waitTime} seconds before retry...`));
                                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                            }
                        } else if (claimResult.success && !claimResult.rateLimited) {
                            // Only wait for funds if claim was successful and NOT rate-limited
                            console.log(chalk.blue(`${getTimestamp(walletNum)} Waiting for faucet funds to be credited to wallet...`));
                            
                            // Create a Web3 instance to check balance
                            const web3 = new Web3(constants.NETWORK.RPC_URL);
                            if (!pk.startsWith('0x')) pk = '0x' + pk;
                            const account = web3.eth.accounts.privateKeyToAccount(pk);
                            
                            // Get initial balance
                            const initialBalance = await web3.eth.getBalance(account.address);
                            console.log(chalk.cyan(`${getTimestamp(walletNum)} ℹ Initial balance: ${web3.utils.fromWei(initialBalance, 'ether')} ${constants.NETWORK.CURRENCY_SYMBOL}`));
                            
                            // Set timeout: 2 minutes
                            const timeoutDuration = 120000; // 2 minutes in milliseconds
                            const startTime = Date.now();
                            const checkInterval = 5000; // Check every 5 seconds
                            
                            let balanceUpdated = false;
                            
                            while (!balanceUpdated && (Date.now() - startTime) < timeoutDuration) {
                                await new Promise(resolve => setTimeout(resolve, checkInterval));
                                
                                try {
                                    const currentBalance = await web3.eth.getBalance(account.address);
                                    console.log(chalk.cyan(`${getTimestamp(walletNum)} ℹ Current balance: ${web3.utils.fromWei(currentBalance, 'ether')} ${constants.NETWORK.CURRENCY_SYMBOL}`));
                                    
                                    if (BigInt(currentBalance) > BigInt(initialBalance)) {
                                        console.log(chalk.green(`${getTimestamp(walletNum)} ✓ Balance increased! Faucet funds received.`));
                                        balanceUpdated = true;
                                        break;
                                    }
                                } catch (error) {
                                    console.log(chalk.yellow(`${getTimestamp(walletNum)} ⚠ Error checking balance: ${error.message}`));
                                }
                                
                                // Show how much time is remaining
                                const elapsed = Date.now() - startTime;
                                const remaining = Math.max(0, timeoutDuration - elapsed);
                                const remainingSec = Math.ceil(remaining / 1000);
                                console.log(chalk.cyan(`${getTimestamp(walletNum)} ℹ Waiting for funds... (${remainingSec}s remaining)`));
                            }
                            
                            if (!balanceUpdated) {
                                console.log(chalk.yellow(`${getTimestamp(walletNum)} ⚠ Timeout reached waiting for faucet funds. Continuing anyway...`));
                            }
                        }
                    }
                }

                // 2. Transfer tokens to self if enabled
                if (config.enable_transfer) {
                    let success = false;
                    let attempt = 0;
                    
                    while (!success && attempt < config.max_retries) {
                        console.log(chalk.blue.bold(`${getTimestamp(walletNum)} Transferring tokens... (Attempt ${attempt + 1}/${config.max_retries})`));
                        success = await tokenTransfer.transferToSelf(pk, walletNum);
                        
                        if (!success) {
                            attempt++;
                            if (attempt < config.max_retries) {
                                const waitTime = Math.min(300, config.base_wait_time * (2 ** attempt));
                                console.log(chalk.yellow(`${getTimestamp(walletNum)} Waiting ${waitTime} seconds before retry...`));
                                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                            }
                        }
                    }
                }
                
                // 3. Execute bridge operations if enabled
                if (config.enable_bridge) {
                    try {
                        console.log(chalk.blue.bold(`\n=== Running Bridge Operations for Wallet ${walletNum} ===\n`));
                        
                        // Initialize bridge manager with wallet number
                        bridgeManager.setWalletNum(walletNum);
                        
                        // Check for Moonveil to Sepolia bridging
                        if (config.bridge?.to_sepolia?.enabled) {
                            console.log(chalk.blue.bold(`${getTimestamp(walletNum)} Running Moonveil → Sepolia bridge operations...`));
                            const success = await bridgeManager.bridgeToSepolia(pk);
                            
                            if (!success) {
                                console.log(chalk.yellow(`${getTimestamp(walletNum)} ⚠ Moonveil → Sepolia bridge operations failed`));
                            }
                        }
                        
                        // Check for Sepolia to Moonveil bridging
                        if (config.bridge?.to_moonveil?.enabled) {
                            console.log(chalk.blue.bold(`${getTimestamp(walletNum)} Running Sepolia → Moonveil bridge operations...`));
                            const success = await bridgeManager.bridgeToMoonveil(pk);
                            
                            if (!success) {
                                console.log(chalk.yellow(`${getTimestamp(walletNum)} ⚠ Sepolia → Moonveil bridge operations failed`));
                            }
                        }
                        
                        // If neither direction is enabled explicitly, log a message
                        if (!config.bridge?.to_sepolia?.enabled && !config.bridge?.to_moonveil?.enabled) {
                            console.log(chalk.yellow(`${getTimestamp(walletNum)} ⚠ No bridge direction enabled in config, skipping bridge operations`));
                        }
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(walletNum)} ✗ Error in bridge operations: ${error.message}`));
                    }
                }
                
                // 4. Deploy smart contract if enabled
                if (config.enable_contract_deploy) {
                    try {
                        console.log(chalk.blue.bold(`\n=== Running Contract Operations for Wallet ${walletNum} ===\n`));
                        
                        // Initialize contract deployer with wallet's private key and current config
                        const contractDeployer = new ContractDeployer(pk, config);
                        contractDeployer.setWalletNum(walletNum);
                        
                        // Execute contract operations (compile, deploy, interact)
                        await contractDeployer.executeContractOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(walletNum)} ✗ Error in contract operations: ${error.message}`));
                    }
                }
                
                // 5. Deploy ERC20 token if enabled
                if (config.erc20 && config.erc20.enable_erc20) {
                    try {
                        console.log(chalk.blue.bold(`\n=== Running ERC20 Token Operations for Wallet ${walletNum} ===\n`));
                        
                        // Initialize ERC20 token deployer with wallet's private key and current config
                        const erc20Deployer = new ERC20TokenDeployer(pk, config);
                        erc20Deployer.setWalletNum(walletNum);
                        
                        // Execute ERC20 token operations (compile, deploy, mint, burn)
                        await erc20Deployer.executeTokenOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(walletNum)} ✗ Error in ERC20 token operations: ${error.message}`));
                    }
                }
                
                // 6. Deploy NFT collection if enabled
                if (config.nft && config.nft.enable_nft) {
                    try {
                        console.log(chalk.blue.bold(`\n=== Running NFT Operations for Wallet ${walletNum} ===\n`));
                        
                        // Initialize NFT manager with wallet's private key and current config
                        const nftManager = new NFTManager(pk, config);
                        nftManager.setWalletNum(walletNum);
                        
                        // Execute NFT operations (compile, deploy, mint, burn)
                        await nftManager.executeNFTOperations();
                        
                    } catch (error) {
                        console.log(chalk.red(`${getTimestamp(walletNum)} ✗ Error in NFT operations: ${error.message}`));
                    }
                }

                // Wait between wallets
                if (i < privateKeys.length - 1) {
                    const waitTime = Math.floor(Math.random() * 11) + 5; // 5-15 seconds
                    console.log(chalk.yellow(`\n${getTimestamp(walletNum)} Waiting ${waitTime} seconds before next wallet...\n`));
                    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                }
            }

            console.log(chalk.green.bold('\nWallet processing completed! Starting 8-hour countdown...\n'));

            // Start the countdown timer
            await countdownTimer(8);

        } catch (error) {
            console.error(chalk.red(`\nError: ${error.message}`));
            process.exit(1);
        }
    }
}

main().catch(console.error);