/**
 * Main Indexer Service
 * Coordinates EVM, Solana, and Bitcoin indexers
 */

require('dotenv').config();
const { EVMIndexer } = require('./evmIndexer');
const { SolanaIndexer } = require('./solanaIndexer');
const { BTCIndexer } = require('./btcIndexer');
const express = require('express');
const cors = require('cors');

class IndexerService {
  constructor() {
    this.evmIndexer = null;
    this.solanaIndexer = null;
    this.btcIndexer = null;
    this.app = express();
    
    this.setupExpress();
  }

  setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Register BTC address
    this.app.post('/api/btc/register', async (req, res) => {
      try {
        const { userAddress, btcAddress } = req.body;
        
        if (!userAddress || !btcAddress) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        await this.btcIndexer.registerUserAddress(userAddress, btcAddress);
        
        res.json({ success: true });
      } catch (error) {
        console.error('Error registering BTC address:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get BTC deposits for address
    this.app.get('/api/btc/deposits/:address', async (req, res) => {
      try {
        const { address } = req.params;
        
        const result = await this.btcIndexer.db.query(
          `SELECT * FROM btc_deposits 
           WHERE vault_address = $1 
           ORDER BY timestamp DESC`,
          [address]
        );

        res.json({ deposits: result.rows });
      } catch (error) {
        console.error('Error fetching deposits:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Get user balance
    this.app.get('/api/balance/:chain/:asset/:address', async (req, res) => {
      try {
        const { chain, asset, address } = req.params;
        
        const result = await this.evmIndexer.db.query(
          `SELECT shares FROM user_shares 
           WHERE chain = $1 AND asset = $2 AND user_address = $3`,
          [chain, asset, address.toLowerCase()]
        );

        const shares = result.rows[0]?.shares || '0';
        
        res.json({ shares });
      } catch (error) {
        console.error('Error fetching balance:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Trigger reconciliation
    this.app.post('/api/reconcile', async (req, res) => {
      try {
        console.log('🔄 Manual reconciliation triggered');
        
        await Promise.all([
          this.evmIndexer.reconcile(),
          this.solanaIndexer.reconcile(),
        ]);

        res.json({ success: true, message: 'Reconciliation complete' });
      } catch (error) {
        console.error('Error during reconciliation:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  async start() {
    console.log('🚀 Starting Nexxore Indexer Service...\n');

    // Initialize EVM indexer
    console.log('📊 Initializing EVM indexer...');
    this.evmIndexer = new EVMIndexer({
      databaseUrl: process.env.DATABASE_URL,
      rpcUrls: {
        mainnet: process.env.MAINNET_RPC_URL,
        polygon: process.env.POLYGON_RPC_URL,
        arbitrum: process.env.ARBITRUM_RPC_URL,
        base: process.env.BASE_RPC_URL,
      },
      vaults: JSON.parse(process.env.EVM_VAULTS || '{}'),
      abis: {
        vault: require('../contracts/evm/artifacts/NexxoreVault.json').abi,
      },
      deploymentBlocks: JSON.parse(process.env.DEPLOYMENT_BLOCKS || '{}'),
    });
    await this.evmIndexer.start();

    // Initialize Solana indexer
    console.log('\n📊 Initializing Solana indexer...');
    this.solanaIndexer = new SolanaIndexer({
      databaseUrl: process.env.DATABASE_URL,
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      programId: process.env.SOLANA_PROGRAM_ID,
      idl: require('../contracts/solana/target/idl/nexxore_vault.json'),
    });
    await this.solanaIndexer.start();

    // Initialize Bitcoin indexer
    console.log('\n📊 Initializing Bitcoin indexer...');
    this.btcIndexer = new BTCIndexer({
      databaseUrl: process.env.DATABASE_URL,
      btcApiUrl: process.env.BTC_API_URL,
      pollInterval: parseInt(process.env.BTC_POLL_INTERVAL || '60000'),
    });
    await this.btcIndexer.start();

    // Start API server
    const port = process.env.PORT || 3001;
    this.app.listen(port, () => {
      console.log(`\n✅ Indexer API running on port ${port}`);
    });

    // Schedule periodic reconciliation
    setInterval(() => {
      console.log('\n🔄 Running scheduled reconciliation...');
      this.evmIndexer.reconcile();
      this.solanaIndexer.reconcile();
    }, 3600000); // Every hour
  }
}

// Start the service
const service = new IndexerService();
service.start().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
