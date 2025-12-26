/**
 * EVM Event Indexer for Nexxore Vault
 * Indexes deposit/withdraw events and maintains ledger
 */

const { ethers } = require('ethers');
const { Pool } = require('pg');

class EVMIndexer {
  constructor(config) {
    this.config = config;
    this.providers = {};
    this.vaultContracts = {};
    this.db = new Pool({
      connectionString: config.databaseUrl,
    });
    
    this.initProviders();
    this.initContracts();
  }

  initProviders() {
    // Initialize providers for each chain
    this.providers.mainnet = new ethers.providers.JsonRpcProvider(
      this.config.rpcUrls.mainnet
    );
    this.providers.polygon = new ethers.providers.JsonRpcProvider(
      this.config.rpcUrls.polygon
    );
    this.providers.arbitrum = new ethers.providers.JsonRpcProvider(
      this.config.rpcUrls.arbitrum
    );
    this.providers.base = new ethers.providers.JsonRpcProvider(
      this.config.rpcUrls.base
    );
  }

  initContracts() {
    const vaultABI = this.config.abis.vault;

    for (const [chain, vaults] of Object.entries(this.config.vaults)) {
      this.vaultContracts[chain] = {};
      
      for (const [asset, address] of Object.entries(vaults)) {
        this.vaultContracts[chain][asset] = new ethers.Contract(
          address,
          vaultABI,
          this.providers[chain]
        );
      }
    }
  }

  async start() {
    console.log('🚀 Starting EVM indexer...');

    // Index historical events
    await this.indexHistorical();

    // Start real-time monitoring
    this.startRealTimeIndexing();
  }

  async indexHistorical() {
    console.log('📜 Indexing historical events...');

    for (const [chain, vaults] of Object.entries(this.vaultContracts)) {
      for (const [asset, contract] of Object.entries(vaults)) {
        try {
          // Get last indexed block for this vault
          const lastBlock = await this.getLastIndexedBlock(chain, asset);
          const currentBlock = await this.providers[chain].getBlockNumber();

          console.log(`Indexing ${chain}/${asset} from block ${lastBlock} to ${currentBlock}`);

          // Index in chunks to avoid rate limits
          const chunkSize = 10000;
          for (let fromBlock = lastBlock; fromBlock < currentBlock; fromBlock += chunkSize) {
            const toBlock = Math.min(fromBlock + chunkSize - 1, currentBlock);
            
            await this.indexBlockRange(chain, asset, contract, fromBlock, toBlock);
            
            // Update last indexed block
            await this.updateLastIndexedBlock(chain, asset, toBlock);
          }

          console.log(`✅ Completed indexing ${chain}/${asset}`);
        } catch (error) {
          console.error(`❌ Error indexing ${chain}/${asset}:`, error);
        }
      }
    }
  }

  async indexBlockRange(chain, asset, contract, fromBlock, toBlock) {
    // Get deposit events
    const depositFilter = contract.filters.Deposit();
    const depositEvents = await contract.queryFilter(depositFilter, fromBlock, toBlock);

    for (const event of depositEvents) {
      await this.processDepositEvent(chain, asset, event);
    }

    // Get withdraw events
    const withdrawFilter = contract.filters.Withdraw();
    const withdrawEvents = await contract.queryFilter(withdrawFilter, fromBlock, toBlock);

    for (const event of withdrawEvents) {
      await this.processWithdrawEvent(chain, asset, event);
    }
  }

  async processDepositEvent(chain, asset, event) {
    const { user, assets, shares, timestamp } = event.args;
    
    try {
      await this.db.query(
        `INSERT INTO deposits (
          chain, asset, user_address, assets, shares, 
          timestamp, tx_hash, block_number, log_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [
          chain,
          asset,
          user.toLowerCase(),
          assets.toString(),
          shares.toString(),
          new Date(timestamp.toNumber() * 1000),
          event.transactionHash,
          event.blockNumber,
          event.logIndex,
        ]
      );

      // Update user shares
      await this.updateUserShares(chain, asset, user, shares, 'add');

      console.log(`📥 Deposit: ${user} deposited ${ethers.utils.formatUnits(assets, 18)} on ${chain}`);
    } catch (error) {
      console.error('Error processing deposit:', error);
    }
  }

  async processWithdrawEvent(chain, asset, event) {
    const { user, assets, shares, timestamp } = event.args;
    
    try {
      await this.db.query(
        `INSERT INTO withdrawals (
          chain, asset, user_address, assets, shares, 
          timestamp, tx_hash, block_number, log_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tx_hash, log_index) DO NOTHING`,
        [
          chain,
          asset,
          user.toLowerCase(),
          assets.toString(),
          shares.toString(),
          new Date(timestamp.toNumber() * 1000),
          event.transactionHash,
          event.blockNumber,
          event.logIndex,
        ]
      );

      // Update user shares
      await this.updateUserShares(chain, asset, user, shares, 'subtract');

      console.log(`📤 Withdraw: ${user} withdrew ${ethers.utils.formatUnits(assets, 18)} on ${chain}`);
    } catch (error) {
      console.error('Error processing withdrawal:', error);
    }
  }

  async updateUserShares(chain, asset, userAddress, shares, operation) {
    const user = userAddress.toLowerCase();
    
    const currentShares = await this.db.query(
      `SELECT shares FROM user_shares 
       WHERE chain = $1 AND asset = $2 AND user_address = $3`,
      [chain, asset, user]
    );

    let newShares;
    if (currentShares.rows.length === 0) {
      newShares = operation === 'add' ? shares.toString() : '0';
    } else {
      const current = ethers.BigNumber.from(currentShares.rows[0].shares);
      newShares = operation === 'add'
        ? current.add(shares).toString()
        : current.sub(shares).toString();
    }

    await this.db.query(
      `INSERT INTO user_shares (chain, asset, user_address, shares, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (chain, asset, user_address) 
       DO UPDATE SET shares = $4, updated_at = NOW()`,
      [chain, asset, user, newShares]
    );
  }

  startRealTimeIndexing() {
    console.log('👂 Starting real-time event monitoring...');

    for (const [chain, vaults] of Object.entries(this.vaultContracts)) {
      for (const [asset, contract] of Object.entries(vaults)) {
        // Listen for deposits
        contract.on('Deposit', async (user, assets, shares, timestamp, event) => {
          console.log(`🔔 New deposit on ${chain}/${asset}`);
          await this.processDepositEvent(chain, asset, event);
        });

        // Listen for withdrawals
        contract.on('Withdraw', async (user, assets, shares, timestamp, event) => {
          console.log(`🔔 New withdrawal on ${chain}/${asset}`);
          await this.processWithdrawEvent(chain, asset, event);
        });
      }
    }
  }

  async getLastIndexedBlock(chain, asset) {
    const result = await this.db.query(
      `SELECT last_block FROM indexer_state 
       WHERE chain = $1 AND asset = $2`,
      [chain, asset]
    );

    if (result.rows.length === 0) {
      // Return deployment block or 0
      return this.config.deploymentBlocks?.[chain]?.[asset] || 0;
    }

    return result.rows[0].last_block;
  }

  async updateLastIndexedBlock(chain, asset, blockNumber) {
    await this.db.query(
      `INSERT INTO indexer_state (chain, asset, last_block, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (chain, asset) 
       DO UPDATE SET last_block = $3, updated_at = NOW()`,
      [chain, asset, blockNumber]
    );
  }

  async reconcile() {
    console.log('🔄 Reconciling ledger with on-chain state...');

    for (const [chain, vaults] of Object.entries(this.vaultContracts)) {
      for (const [asset, contract] of Object.entries(vaults)) {
        try {
          const vaultTotalShares = await contract.totalShares();
          
          const dbResult = await this.db.query(
            `SELECT SUM(shares::numeric) as total_shares 
             FROM user_shares 
             WHERE chain = $1 AND asset = $2`,
            [chain, asset]
          );

          const dbTotalShares = dbResult.rows[0].total_shares || '0';
          
          if (vaultTotalShares.toString() !== dbTotalShares) {
            console.warn(
              `⚠️  Mismatch on ${chain}/${asset}: 
               On-chain: ${vaultTotalShares.toString()}, 
               DB: ${dbTotalShares}`
            );
          } else {
            console.log(`✅ ${chain}/${asset} reconciled successfully`);
          }
        } catch (error) {
          console.error(`Error reconciling ${chain}/${asset}:`, error);
        }
      }
    }
  }
}

module.exports = { EVMIndexer };
