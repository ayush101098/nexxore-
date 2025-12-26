/**
 * Solana Program Log Indexer for Nexxore Vault
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { Program, AnchorProvider } = require('@coral-xyz/anchor');
const { Pool } = require('pg');

class SolanaIndexer {
  constructor(config) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.programId = new PublicKey(config.programId);
    this.db = new Pool({
      connectionString: config.databaseUrl,
    });
    
    this.program = null;
  }

  async init() {
    // Initialize Anchor program
    const provider = new AnchorProvider(
      this.connection,
      null, // No wallet needed for reading
      { commitment: 'confirmed' }
    );

    this.program = new Program(
      this.config.idl,
      this.programId,
      provider
    );
  }

  async start() {
    console.log('🚀 Starting Solana indexer...');

    await this.init();
    await this.indexHistorical();
    this.startRealTimeIndexing();
  }

  async indexHistorical() {
    console.log('📜 Indexing historical Solana transactions...');

    try {
      // Get all vault accounts
      const vaults = await this.program.account.vault.all();

      for (const vault of vaults) {
        console.log(`Indexing vault: ${vault.publicKey.toString()}`);
        
        // Get all signatures for this vault
        const signatures = await this.connection.getSignaturesForAddress(
          vault.publicKey,
          { limit: 1000 }
        );

        for (const sig of signatures) {
          await this.processTransaction(sig.signature);
        }
      }

      console.log('✅ Historical indexing complete');
    } catch (error) {
      console.error('❌ Error indexing historical data:', error);
    }
  }

  async processTransaction(signature) {
    try {
      // Check if already indexed
      const existing = await this.db.query(
        'SELECT 1 FROM solana_transactions WHERE signature = $1',
        [signature]
      );

      if (existing.rows.length > 0) {
        return;
      }

      // Get transaction details
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
      });

      if (!tx) return;

      // Parse logs for events
      const events = this.parseLogsForEvents(tx.meta.logMessages || []);

      for (const event of events) {
        await this.processEvent(event, signature, tx.blockTime);
      }

      // Mark as indexed
      await this.db.query(
        'INSERT INTO solana_transactions (signature, indexed_at) VALUES ($1, NOW())',
        [signature]
      );
    } catch (error) {
      console.error(`Error processing transaction ${signature}:`, error);
    }
  }

  parseLogsForEvents(logs) {
    const events = [];

    for (const log of logs) {
      // Parse Anchor event logs
      if (log.includes('Program log: ')) {
        const logData = log.replace('Program log: ', '');
        
        if (logData.startsWith('Deposited')) {
          const match = logData.match(/Deposited (\d+) tokens, minted (\d+) shares/);
          if (match) {
            events.push({
              type: 'deposit',
              amount: match[1],
              shares: match[2],
            });
          }
        } else if (logData.startsWith('Withdrew')) {
          const match = logData.match(/Withdrew (\d+) assets, burned (\d+) shares/);
          if (match) {
            events.push({
              type: 'withdraw',
              assets: match[1],
              shares: match[2],
            });
          }
        }
      }
    }

    return events;
  }

  async processEvent(event, signature, timestamp) {
    const table = event.type === 'deposit' ? 'deposits' : 'withdrawals';
    
    try {
      if (event.type === 'deposit') {
        await this.db.query(
          `INSERT INTO ${table} (
            chain, asset, user_address, assets, shares, 
            timestamp, tx_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (tx_hash) DO NOTHING`,
          [
            'solana',
            'SOL', // Would need to determine asset from transaction
            'unknown', // Would need to parse from transaction
            event.amount,
            event.shares,
            new Date(timestamp * 1000),
            signature,
          ]
        );
      } else {
        await this.db.query(
          `INSERT INTO ${table} (
            chain, asset, user_address, assets, shares, 
            timestamp, tx_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (tx_hash) DO NOTHING`,
          [
            'solana',
            'SOL',
            'unknown',
            event.assets,
            event.shares,
            new Date(timestamp * 1000),
            signature,
          ]
        );
      }

      console.log(`✅ Processed ${event.type} event from ${signature.slice(0, 8)}...`);
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }

  startRealTimeIndexing() {
    console.log('👂 Starting real-time Solana monitoring...');

    // Subscribe to program account changes
    this.connection.onProgramAccountChange(
      this.programId,
      async (accountInfo) => {
        console.log('🔔 Program account changed');
        
        // Get recent signatures
        const signatures = await this.connection.getSignaturesForAddress(
          accountInfo.accountId,
          { limit: 10 }
        );

        for (const sig of signatures) {
          await this.processTransaction(sig.signature);
        }
      },
      'confirmed'
    );

    // Also subscribe to logs
    this.connection.onLogs(
      this.programId,
      async (logs) => {
        console.log('🔔 New Solana transaction');
        await this.processTransaction(logs.signature);
      },
      'confirmed'
    );
  }

  async reconcile() {
    console.log('🔄 Reconciling Solana ledger...');

    try {
      const vaults = await this.program.account.vault.all();

      for (const vault of vaults) {
        const onChainShares = vault.account.totalShares.toString();
        
        // Sum from database
        const dbResult = await this.db.query(
          `SELECT SUM(shares::numeric) as total_shares 
           FROM user_shares 
           WHERE chain = 'solana' AND vault_address = $1`,
          [vault.publicKey.toString()]
        );

        const dbShares = dbResult.rows[0].total_shares || '0';

        if (onChainShares !== dbShares) {
          console.warn(
            `⚠️  Mismatch on vault ${vault.publicKey.toString()}: 
             On-chain: ${onChainShares}, DB: ${dbShares}`
          );
        } else {
          console.log(`✅ Vault ${vault.publicKey.toString()} reconciled`);
        }
      }
    } catch (error) {
      console.error('Error reconciling:', error);
    }
  }
}

module.exports = { SolanaIndexer };
