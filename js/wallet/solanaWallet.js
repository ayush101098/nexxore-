/**
 * Nexxore Solana Wallet Integration
 * Supports Phantom, Backpack, and other Solana wallets
 */

import { 
  ConnectionProvider, 
  WalletProvider,
  useWallet,
  useConnection 
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  BackpackWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';

// Network configuration
const NETWORK = 'mainnet-beta'; // or 'devnet'
const ENDPOINT = clusterApiUrl(NETWORK);

// Wallet adapters
export const wallets = [
  new PhantomWalletAdapter(),
  new BackpackWalletAdapter(),
  new SolflareWalletAdapter(),
];

// ============ Wallet Manager ============

class SolanaWalletManager {
  constructor() {
    this.connection = new Connection(ENDPOINT, 'confirmed');
    this.wallet = null;
    this.publicKey = null;
    this.connected = false;
    this.listeners = new Set();
  }

  setWallet(wallet) {
    this.wallet = wallet;
    this.publicKey = wallet?.publicKey;
    this.connected = wallet?.connected || false;
    this.notify();
  }

  async connect(walletName = 'Phantom') {
    try {
      const adapter = wallets.find(w => 
        w.name.toLowerCase().includes(walletName.toLowerCase())
      );
      
      if (!adapter) {
        throw new Error(`Wallet ${walletName} not found`);
      }

      await adapter.connect();
      this.setWallet(adapter);
      return true;
    } catch (error) {
      console.error('Failed to connect Solana wallet:', error);
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.wallet) {
        await this.wallet.disconnect();
      }
      this.setWallet(null);
      return true;
    } catch (error) {
      console.error('Failed to disconnect:', error);
      return false;
    }
  }

  getState() {
    return {
      publicKey: this.publicKey?.toString(),
      connected: this.connected,
      network: NETWORK,
    };
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    const state = this.getState();
    this.listeners.forEach(callback => callback(state));
  }

  getShortAddress() {
    if (!this.publicKey) return '';
    const address = this.publicKey.toString();
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }
}

export const solanaWallet = new SolanaWalletManager();

// ============ Vault Program Interface ============

export class SolanaVaultProgram {
  constructor(programId, idl) {
    this.programId = new PublicKey(programId);
    this.idl = idl;
    this.connection = new Connection(ENDPOINT, 'confirmed');
  }

  getProvider(wallet) {
    return new AnchorProvider(
      this.connection,
      wallet,
      { commitment: 'confirmed' }
    );
  }

  getProgram(wallet) {
    const provider = this.getProvider(wallet);
    return new Program(this.idl, this.programId, provider);
  }

  async deposit(wallet, tokenMint, amount) {
    try {
      const program = this.getProgram(wallet);
      
      // Derive PDAs
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), tokenMint.toBuffer()],
        this.programId
      );

      const [userSharesPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('user_shares'),
          vaultPda.toBuffer(),
          wallet.publicKey.toBuffer()
        ],
        this.programId
      );

      // Get token accounts
      const userTokenAccount = await this.getUserTokenAccount(
        wallet.publicKey,
        tokenMint
      );
      
      const vaultTokenAccount = await this.getVaultTokenAccount(
        vaultPda,
        tokenMint
      );

      // Execute deposit
      const tx = await program.methods
        .deposit(amount)
        .accounts({
          vault: vaultPda,
          userShares: userSharesPda,
          userTokenAccount,
          vaultTokenAccount,
          user: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, 'confirmed');
      return { success: true, signature: tx };
    } catch (error) {
      console.error('Deposit failed:', error);
      return { success: false, error };
    }
  }

  async withdraw(wallet, tokenMint, shares) {
    try {
      const program = this.getProgram(wallet);
      
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), tokenMint.toBuffer()],
        this.programId
      );

      const [userSharesPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('user_shares'),
          vaultPda.toBuffer(),
          wallet.publicKey.toBuffer()
        ],
        this.programId
      );

      const userTokenAccount = await this.getUserTokenAccount(
        wallet.publicKey,
        tokenMint
      );
      
      const vaultTokenAccount = await this.getVaultTokenAccount(
        vaultPda,
        tokenMint
      );

      const tx = await program.methods
        .withdraw(shares)
        .accounts({
          vault: vaultPda,
          userShares: userSharesPda,
          userTokenAccount,
          vaultTokenAccount,
          user: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      await this.connection.confirmTransaction(tx, 'confirmed');
      return { success: true, signature: tx };
    } catch (error) {
      console.error('Withdrawal failed:', error);
      return { success: false, error };
    }
  }

  async getUserShares(userPublicKey, tokenMint) {
    try {
      const program = this.getProgram(solanaWallet.wallet);
      
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), tokenMint.toBuffer()],
        this.programId
      );

      const [userSharesPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('user_shares'),
          vaultPda.toBuffer(),
          userPublicKey.toBuffer()
        ],
        this.programId
      );

      const account = await program.account.userShares.fetch(userSharesPda);
      return account.shares;
    } catch (error) {
      console.error('Failed to fetch shares:', error);
      return 0;
    }
  }

  async getVaultInfo(tokenMint) {
    try {
      const program = this.getProgram(solanaWallet.wallet);
      
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), tokenMint.toBuffer()],
        this.programId
      );

      const vault = await program.account.vault.fetch(vaultPda);
      return {
        totalAssets: vault.totalAssets,
        totalShares: vault.totalShares,
        paused: vault.paused,
      };
    } catch (error) {
      console.error('Failed to fetch vault info:', error);
      return null;
    }
  }

  async getUserTokenAccount(owner, mint) {
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    return await getAssociatedTokenAddress(mint, owner);
  }

  async getVaultTokenAccount(vault, mint) {
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    return await getAssociatedTokenAddress(mint, vault, true);
  }
}

// ============ Helper Functions ============

export function formatSolAddress(address) {
  if (!address) return '';
  const addr = typeof address === 'string' ? address : address.toString();
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function lamportsToSol(lamports) {
  return lamports / web3.LAMPORTS_PER_SOL;
}

export function solToLamports(sol) {
  return Math.floor(sol * web3.LAMPORTS_PER_SOL);
}
