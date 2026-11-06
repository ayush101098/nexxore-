/**
 * useWeb3 React Hook
 * Manages wallet connection, network switching, and transaction signing
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  custom,
  parseEther,
  formatEther,
  type Address,
  type Hash,
  type Chain,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt
} from 'viem';
import { mainnet, sepolia, arbitrum } from 'viem/chains';
import { useConnect, useAccount, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

// Supported chains
const SUPPORTED_CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
  42161: arbitrum,
};

// RPC URLs
const RPC_URLS: Record<number, string> = {
  1: process.env.NEXT_PUBLIC_MAINNET_RPC || 'https://eth-mainnet.g.alchemy.com/v2/your-key',
  11155111: process.env.NEXT_PUBLIC_SEPOLIA_RPC || 'https://eth-sepolia.g.alchemy.com/v2/your-key',
  42161: process.env.NEXT_PUBLIC_ARBITRUM_RPC || 'https://arb-mainnet.g.alchemy.com/v2/your-key',
};

export interface Web3State {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  address: Address | undefined;
  chainId: number | undefined;
  
  // Clients
  publicClient: PublicClient | null;
  walletClient: WalletClient | null;
  
  // Balance
  balance: bigint;
  formattedBalance: string;
  
  // Network
  chain: Chain | undefined;
  isCorrectNetwork: boolean;
  
  // Actions
  connect: (connector?: 'injected' | 'walletConnect') => Promise<void>;
  disconnect: () => void;
  switchNetwork: (chainId: number) => Promise<void>;
  signMessage: (message: string) => Promise<string>;
  sendTransaction: (tx: TransactionRequest) => Promise<Hash>;
  waitForTransaction: (hash: Hash) => Promise<TransactionReceipt>;
  
  // Error handling
  error: Error | null;
}

export interface TransactionRequest {
  to: Address;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export function useWeb3(targetChainId: number = 1): Web3State {
  const { connect: wagmiConnect, connectors, isPending: isConnecting } = useConnect();
  const { address, isConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [balance, setBalance] = useState<bigint>(BigInt(0));
  const [error, setError] = useState<Error | null>(null);
  const [publicClient, setPublicClient] = useState<PublicClient | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  // Initialize clients
  useEffect(() => {
    const chain = SUPPORTED_CHAINS[chainId || targetChainId];
    if (!chain) return;

    // Public client for read operations
    const newPublicClient = createPublicClient({
      chain,
      transport: http(RPC_URLS[chain.id]),
    });
    setPublicClient(newPublicClient);

    // Wallet client for write operations (only if connected)
    if (isConnected && typeof window !== 'undefined' && window.ethereum) {
      const newWalletClient = createWalletClient({
        chain,
        transport: custom(window.ethereum),
      });
      setWalletClient(newWalletClient);
    } else {
      setWalletClient(null);
    }
  }, [chainId, targetChainId, isConnected]);

  // Fetch balance
  useEffect(() => {
    if (!publicClient || !address) {
      setBalance(BigInt(0));
      return;
    }

    const fetchBalance = async () => {
      try {
        const bal = await publicClient.getBalance({ address });
        setBalance(bal);
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [publicClient, address]);

  // Connect wallet
  const connect = useCallback(async (connector: 'injected' | 'walletConnect' = 'injected') => {
    setError(null);
    try {
      const selectedConnector = connectors.find(c => 
        connector === 'injected' ? c.id === 'injected' : c.id === 'walletConnect'
      );
      
      if (!selectedConnector) {
        throw new Error(`Connector ${connector} not found`);
      }
      
      await wagmiConnect({ connector: selectedConnector });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Connection failed');
      setError(error);
      throw error;
    }
  }, [wagmiConnect, connectors]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    wagmiDisconnect();
    setError(null);
  }, [wagmiDisconnect]);

  // Switch network
  const switchNetwork = useCallback(async (newChainId: number) => {
    setError(null);
    try {
      if (!SUPPORTED_CHAINS[newChainId]) {
        throw new Error(`Chain ${newChainId} not supported`);
      }
      
      await switchChain({ chainId: newChainId });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Network switch failed');
      setError(error);
      throw error;
    }
  }, [switchChain]);

  // Sign message
  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }
    
    setError(null);
    try {
      const signature = await walletClient.signMessage({
        account: address,
        message,
      });
      return signature;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Signing failed');
      setError(error);
      throw error;
    }
  }, [walletClient, address]);

  // Send transaction
  const sendTransaction = useCallback(async (tx: TransactionRequest): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }
    
    setError(null);
    try {
      const hash = await walletClient.sendTransaction({
        account: address,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
        gasPrice: tx.gasPrice,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        chain: SUPPORTED_CHAINS[chainId!],
      });
      return hash;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Transaction failed');
      setError(error);
      throw error;
    }
  }, [walletClient, address, chainId]);

  // Wait for transaction
  const waitForTransaction = useCallback(async (hash: Hash): Promise<TransactionReceipt> => {
    if (!publicClient) {
      throw new Error('Public client not initialized');
    }
    
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Transaction confirmation failed');
      setError(error);
      throw error;
    }
  }, [publicClient]);

  // Computed values
  const chain = SUPPORTED_CHAINS[chainId || 0];
  const isCorrectNetwork = chainId === targetChainId;
  const formattedBalance = formatEther(balance);

  return {
    // Connection state
    isConnected,
    isConnecting,
    address,
    chainId,
    
    // Clients
    publicClient,
    walletClient,
    
    // Balance
    balance,
    formattedBalance,
    
    // Network
    chain,
    isCorrectNetwork,
    
    // Actions
    connect,
    disconnect,
    switchNetwork,
    signMessage,
    sendTransaction,
    waitForTransaction,
    
    // Error
    error,
  };
}

// Utility hook for checking if user has a specific connector
export function useHasConnector(connectorId: string): boolean {
  const { connectors } = useConnect();
  return useMemo(
    () => connectors.some(c => c.id === connectorId),
    [connectors, connectorId]
  );
}

// Utility hook for ENS resolution
export function useEnsName(address: Address | undefined): string | null {
  const [ensName, setEnsName] = useState<string | null>(null);
  
  useEffect(() => {
    if (!address) {
      setEnsName(null);
      return;
    }
    
    const resolveEns = async () => {
      try {
        const client = createPublicClient({
          chain: mainnet,
          transport: http(RPC_URLS[1]),
        });
        
        const name = await client.getEnsName({ address });
        setEnsName(name);
      } catch {
        setEnsName(null);
      }
    };
    
    resolveEns();
  }, [address]);
  
  return ensName;
}

// Utility hook for gas estimation
export function useGasPrice(): { gasPrice: bigint | null; maxFeePerGas: bigint | null; maxPriorityFeePerGas: bigint | null } {
  const [gasData, setGasData] = useState<{
    gasPrice: bigint | null;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
  }>({
    gasPrice: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  });
  
  useEffect(() => {
    const fetchGasPrice = async () => {
      try {
        const client = createPublicClient({
          chain: mainnet,
          transport: http(RPC_URLS[1]),
        });
        
        const gasPrice = await client.getGasPrice();
        const feeData = await client.estimateFeesPerGas();
        
        setGasData({
          gasPrice,
          maxFeePerGas: feeData.maxFeePerGas || null,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || null,
        });
      } catch {
        // Keep previous values
      }
    };
    
    fetchGasPrice();
    const interval = setInterval(fetchGasPrice, 12000); // Every block
    return () => clearInterval(interval);
  }, []);
  
  return gasData;
}

export default useWeb3;
