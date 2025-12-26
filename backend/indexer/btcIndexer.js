/**
 * Bitcoin UTXO Indexer for Nexxore Vault
 * Tracks BTC deposits to vault addresses
 */

const axios = require('axios');
const { Pool } = require('pg');

class BTCIndexer {
  constructor(config) {
    this.config = config;
    this.apiUrl = config.btcApiUrl || 'https://blockstream.info/api';
    this.db = new Pool({
      connectionString: config.databaseUrl,
    });
    
    this.vaultAddresses = new Set();
    this.pollInterval = config.pollInterval || 60000; // 1 minute
  }

  async start() {
    console.log('🚀 Starting Bitcoin indexer...');

    // Load vault addresses from database
    await this.loadVaultAddresses();

    // Index existing transactions
    await this.indexAll();

    // Start polling for new transactions
    this.startPolling();
  }

  async loadVaultAddresses() {
    const result = await this.db.query(
      'SELECT DISTINCT btc_address FROM btc_vault_addresses WHERE active = true'
    );

    this.vaultAddresses = new Set(
      result.rows.map(row => row.btc_address)
    );

    console.log(`Loaded ${this.vaultAddresses.size} vault addresses`);
  }

  async indexAll() {
    console.log('📜 Indexing all vault addresses...');

    for (const address of this.vaultAddresses) {
      await this.indexAddress(address);
    }
  }

  async indexAddress(address) {
    try {
      console.log(`Indexing ${address}...`);

      // Get address info
      const response = await axios.get(`${this.apiUrl}/address/${address}`);
      const data = response.data;

      // Get all transactions
      const txsResponse = await axios.get(`${this.apiUrl}/address/${address}/txs`);
      const transactions = txsResponse.data;

      // Process each transaction
      for (const tx of transactions) {
        await this.processTransaction(address, tx);
      }

      console.log(`✅ Indexed ${address}: ${transactions.length} transactions`);
    } catch (error) {
      console.error(`Error indexing ${address}:`, error.message);
    }
  }

  async processTransaction(vaultAddress, tx) {
    try {
      // Check if already indexed
      const existing = await this.db.query(
        'SELECT 1 FROM btc_deposits WHERE txid = $1 AND vout_index = ANY($2)',
        [tx.txid, tx.vout.map((_, i) => i)]
      );

      if (existing.rows.length > 0) {
        return;
      }

      // Find outputs to our vault address
      for (let i = 0; i < tx.vout.length; i++) {
        const output = tx.vout[i];
        
        if (output.scriptpubkey_address === vaultAddress) {
          // This is a deposit to our vault
          const amount = output.value;
          const confirmations = tx.status.confirmed ? 
            await this.getConfirmations(tx.status.block_height) : 0;

          // Get user mapping
          const userMapping = await this.getUserForAddress(vaultAddress);

          await this.db.query(
            `INSERT INTO btc_deposits (
              vault_address, user_address, txid, vout_index, 
              amount, confirmations, timestamp, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (txid, vout_index) DO UPDATE SET
              confirmations = $5,
              status = $8`,
            [
              vaultAddress,
              userMapping?.user_address || null,
              tx.txid,
              i,
              amount,
              confirmations,
              new Date(tx.status.block_time * 1000),
              confirmations >= 3 ? 'confirmed' : 'pending',
            ]
          );

          // If confirmed, credit user
          if (confirmations >= 3) {
            await this.creditUserDeposit(userMapping?.user_address, amount, tx.txid);
          }

          console.log(
            `📥 BTC Deposit: ${amount} sats to ${vaultAddress} (${confirmations} conf)`
          );
        }
      }
    } catch (error) {
      console.error(`Error processing transaction ${tx.txid}:`, error);
    }
  }

  async getConfirmations(blockHeight) {
    try {
      const response = await axios.get(`${this.apiUrl}/blocks/tip/height`);
      const currentHeight = response.data;
      return currentHeight - blockHeight + 1;
    } catch (error) {
      return 0;
    }
  }

  async getUserForAddress(btcAddress) {
    const result = await this.db.query(
      'SELECT user_address FROM btc_vault_addresses WHERE btc_address = $1',
      [btcAddress]
    );

    return result.rows[0] || null;
  }

  async creditUserDeposit(userAddress, amount, txid) {
    if (!userAddress) return;

    try {
      // Record in deposits table
      await this.db.query(
        `INSERT INTO deposits (
          chain, asset, user_address, assets, shares, 
          timestamp, tx_hash
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        ON CONFLICT (tx_hash) DO NOTHING`,
        [
          'bitcoin',
          'BTC',
          userAddress,
          amount.toString(),
          amount.toString(), // 1:1 for BTC in v1
          txid,
        ]
      );

      // Update user shares
      await this.db.query(
        `INSERT INTO user_shares (chain, asset, user_address, shares, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (chain, asset, user_address) 
         DO UPDATE SET 
           shares = (user_shares.shares::numeric + $4::numeric)::text,
           updated_at = NOW()`,
        ['bitcoin', 'BTC', userAddress, amount.toString()]
      );

      console.log(`💰 Credited ${amount} sats to ${userAddress}`);
    } catch (error) {
      console.error('Error crediting user:', error);
    }
  }

  startPolling() {
    console.log(`👂 Polling for new BTC transactions every ${this.pollInterval}ms...`);

    setInterval(async () => {
      // Reload addresses in case new ones were added
      await this.loadVaultAddresses();
      
      // Index all addresses
      for (const address of this.vaultAddresses) {
        await this.indexAddress(address);
      }

      // Update confirmations for pending deposits
      await this.updatePendingConfirmations();
    }, this.pollInterval);
  }

  async updatePendingConfirmations() {
    const pending = await this.db.query(
      `SELECT DISTINCT txid, vault_address 
       FROM btc_deposits 
       WHERE status = 'pending'`
    );

    for (const row of pending.rows) {
      try {
        const response = await axios.get(`${this.apiUrl}/tx/${row.txid}`);
        const tx = response.data;

        if (tx.status.confirmed) {
          const confirmations = await this.getConfirmations(tx.status.block_height);
          
          await this.db.query(
            `UPDATE btc_deposits 
             SET confirmations = $1, status = $2 
             WHERE txid = $3`,
            [
              confirmations,
              confirmations >= 3 ? 'confirmed' : 'pending',
              row.txid,
            ]
          );

          // Credit user if just became confirmed
          if (confirmations >= 3) {
            const deposit = await this.db.query(
              'SELECT * FROM btc_deposits WHERE txid = $1',
              [row.txid]
            );

            for (const dep of deposit.rows) {
              await this.creditUserDeposit(
                dep.user_address,
                parseInt(dep.amount),
                dep.txid
              );
            }
          }
        }
      } catch (error) {
        console.error(`Error updating confirmations for ${row.txid}:`, error.message);
      }
    }
  }

  async registerUserAddress(userAddress, btcAddress) {
    await this.db.query(
      `INSERT INTO btc_vault_addresses (user_address, btc_address, active, created_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (btc_address) DO UPDATE SET active = true`,
      [userAddress, btcAddress]
    );

    this.vaultAddresses.add(btcAddress);
    console.log(`✅ Registered BTC address ${btcAddress} for user ${userAddress}`);
  }
}

module.exports = { BTCIndexer };
