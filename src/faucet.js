const { Web3 } = require('web3');
const axios = require('axios');
const chalk = require('chalk');
const { HttpsProxyAgent } = require('https-proxy-agent');
const constants = require('../utils/constants');

function getTimestamp(walletNum = null) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false });
    if (walletNum !== null) {
        return `[${timestamp} - Wallet ${walletNum}]`;
    }
    return `[${timestamp}]`;
}

class FaucetClaimer {
    constructor(config = {}, proxies = []) {
        this.faucetUrl = constants.NETWORK.FAUCET_URL;
        this.web3 = new Web3(constants.NETWORK.RPC_URL);
        
        // Set default config 
        this.config = {
            max_retries: constants.RETRY.MAX_RETRIES,
            base_wait_time: constants.RETRY.BASE_WAIT_TIME,
            enable_faucet: true
        };
        
        // Merge with provided config
        if (config) {
            this.config = { ...this.config, ...config };
            this.maxRetries = this.config.max_retries;
            this.baseWaitTime = this.config.base_wait_time;
        }
        
        // Initialize
        this.proxies = proxies;
        this.currentProxy = null;
        this.retryCodes = new Set([408, 429, 500, 502, 503, 504]);
        this.currentWalletNum = 0;
    }

    getRandomProxy() {
        if (this.proxies.length > 0) {
            this.currentProxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
            return this.currentProxy;
        }
        return null;
    }

    exponentialBackoff(attempt) {
        const waitTime = Math.min(300, this.baseWaitTime * (2 ** attempt));
        const jitter = 0.5 + Math.random();
        return Math.floor(waitTime * jitter);
    }

    async makeRequestWithRetry(method, url, options = {}) {
        let attempt = 0;
        
        // Handle proxy configuration
        if (this.currentProxy) {
            // Create proxy agent
            const proxyUrl = this.currentProxy.startsWith('http') ? 
                this.currentProxy : 
                `http://${this.currentProxy}`;
            
            const httpsAgent = new HttpsProxyAgent(proxyUrl);
            options.httpsAgent = httpsAgent;
            options.proxy = false; // Disable axios proxy handling
        }
        
        // Set appropriate timeout
        if (!options.timeout) {
            options.timeout = 30000;
        }
        
        while (attempt < this.maxRetries) {
            try {
                const response = await axios({
                    method,
                    url,
                    ...options,
                    validateStatus: null // Don't throw error on any status
                });
                
                // For faucet requests, check for rate limit messages regardless of status code
                if (url === this.faucetUrl) {
                    console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} Server response:`), 
                        typeof response.data === 'object' ? JSON.stringify(response.data) : response.data);
                    
                    // Check for rate limit message in the response
                    if (response.status === 429 || 
                        (response.data && response.data.msg && 
                        (response.data.msg.includes("exceeded the rate limit") || 
                         response.data.msg.includes("wait") || 
                         response.data.msg.includes("hour")))) {
                        // This is a rate limit message, consider it as a success to avoid retries
                        console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Rate limited: ${response.data.msg}`));
                        return { response, success: true, rateLimited: true };
                    }
                    
                    if (response.status >= 200 && response.status < 300) {
                        return { response, success: true };
                    }
                }
                
                // For other requests, check status code
                if (!this.retryCodes.has(response.status)) {
                    return { response, success: true };
                }
                
                const waitTime = this.exponentialBackoff(attempt);
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Got status ${response.status}, retrying in ${waitTime}s...`));
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                
                this.getRandomProxy();
                // Update proxy agent if proxy changed
                if (this.currentProxy) {
                    const newProxyUrl = this.currentProxy.startsWith('http') ? 
                        this.currentProxy : 
                        `http://${this.currentProxy}`;
                    options.httpsAgent = new HttpsProxyAgent(newProxyUrl);
                }
                
            } catch (error) {
                const waitTime = this.exponentialBackoff(attempt);
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Request error: ${error.message}`));
                
                if (error.response) {
                    console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} Server response:`),
                        typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data);
                }
                
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Retrying in ${waitTime}s...`));
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                
                this.getRandomProxy();
                // Update proxy agent if proxy changed
                if (this.currentProxy) {
                    const newProxyUrl = this.currentProxy.startsWith('http') ? 
                        this.currentProxy : 
                        `http://${this.currentProxy}`;
                    options.httpsAgent = new HttpsProxyAgent(newProxyUrl);
                }
            }
            
            attempt++;
        }
        
        return { response: null, success: false };
    }

    getAddressFromPk(privateKey) {
        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
            return account.address;
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error generating address: ${error.message}`));
            return null;
        }
    }

    async claimFaucet(privateKey, walletNum = 0) {
        if (!this.config.enable_faucet) {
            return { success: true, rateLimited: false };
        }
    
        this.currentWalletNum = walletNum;
        
        try {
            const address = this.getAddressFromPk(privateKey);
            if (!address) {
                return { success: false, rateLimited: false };
            }
            
            console.log(chalk.blue.bold(`${getTimestamp(this.currentWalletNum)} Claiming from Moonveil faucet...`));
            
            const payload = {
                "address": address
            };
            
            // Use headers from the constants
            const headers = constants.FAUCET.REQUEST_HEADERS;
            
            console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} ℹ Making faucet request for address: ${address}`));
            
            // Make the request
            const proxy = this.getRandomProxy();
            if (proxy) {
                console.log(chalk.cyan(`${getTimestamp(this.currentWalletNum)} ℹ Using proxy: ${proxy}`));
            }
            
            const { response, success, rateLimited } = await this.makeRequestWithRetry('POST', this.faucetUrl, {
                headers,
                data: payload
            });
            
            if (!success || !response) {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ No response from faucet request`));
                return { success: false, rateLimited: false };
            }
            
            // If rate limited, return with special status
            if (rateLimited) {
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Rate limited, moving to next operation`));
                return { success: true, rateLimited: true };
            }
            
            const responseData = response.data;
            
            // Handle possible responses based on the Moonveil faucet
            if (response.status === 429 || 
                (responseData.msg && responseData.msg.includes("exceeded the rate limit"))) {
                console.log(chalk.yellow(`${getTimestamp(this.currentWalletNum)} ⚠ Rate limited: ${responseData.msg}`));
                return { success: true, rateLimited: true };  // Return True with rateLimited flag
            } else if (responseData.msg && responseData.msg.includes("Txhash:")) {
                const txHash = responseData.msg.split("Txhash:")[1].trim();
                console.log(chalk.green(`${getTimestamp(this.currentWalletNum)} ✓ Success! Transaction: ${constants.NETWORK.EXPLORER_URL}/tx/${txHash}`));
                return { success: true, rateLimited: false, txHash: txHash };  // Include txHash in response
            } else {
                console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Unexpected response: ${JSON.stringify(responseData)}`));
                return { success: false, rateLimited: false };
            }
        } catch (error) {
            console.log(chalk.red(`${getTimestamp(this.currentWalletNum)} ✗ Error claiming faucet: ${error.message}`));
            return { success: false, rateLimited: false };
        }
    }
}
module.exports = FaucetClaimer;