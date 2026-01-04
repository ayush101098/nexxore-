/**
 * useVault React Hook
 * Manages vault interactions including deposits, withdrawals, and state
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  type Address, 
  type Hash,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  getContract,
} from 'viem';
import { useWeb3 } from './useWeb3';

// Vault ABI (relevant functions only)
const VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' }
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'withdraw',
    type: 'function',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' }
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'redeem',
    type: 'function',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' }
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'totalAssets',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'totalSupply',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'convertToShares',
    type: 'function',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'convertToAssets',
    type: 'function',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'previewDeposit',
    type: 'function',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'previewRedeem',
    type: 'function',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'maxDeposit',
    type: 'function',
    inputs: [{ name: 'receiver', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'maxWithdraw',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'riskScore',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'currentRiskState',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view'
  },
  {
    name: 'name',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view'
  },
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view'
  }
] as const;

// ERC20 ABI for USDC
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable'
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const;

// Types
export interface VaultState {
  // Vault info
  name: string;
  symbol: string;
  totalAssets: bigint;
  totalSupply: bigint;
  sharePrice: number;
  riskScore: number;
  riskState: RiskState;
  
  // User position
  userShares: bigint;
  userAssets: bigint;
  maxDeposit: bigint;
  maxWithdraw: bigint;
  
  // USDC balance and allowance
  usdcBalance: bigint;
  usdcAllowance: bigint;
  
  // Loading states
  isLoading: boolean;
  isDepositing: boolean;
  isWithdrawing: boolean;
  isApproving: boolean;
  
  // Formatted values
  formattedTotalAssets: string;
  formattedUserShares: string;
  formattedUserAssets: string;
  formattedUsdcBalance: string;
  
  // Actions
  deposit: (amount: string) => Promise<Hash>;
  withdraw: (amount: string) => Promise<Hash>;
  redeem: (shares: string) => Promise<Hash>;
  approve: (amount?: string) => Promise<Hash>;
  previewDeposit: (amount: string) => Promise<bigint>;
  previewRedeem: (shares: string) => Promise<bigint>;
  refresh: () => Promise<void>;
  
  // Error
  error: Error | null;
}

export type RiskState = 'NORMAL' | 'ELEVATED' | 'HIGH_RISK' | 'CRITICAL';

const RISK_STATES: RiskState[] = ['NORMAL', 'ELEVATED', 'HIGH_RISK', 'CRITICAL'];

interface UseVaultOptions {
  vaultAddress: Address;
  usdcAddress?: Address;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

const DEFAULT_USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const USDC_DECIMALS = 6;

export function useVault(options: UseVaultOptions): VaultState {
  const {
    vaultAddress,
    usdcAddress = DEFAULT_USDC_ADDRESS,
    autoRefresh = true,
    refreshInterval = 15000,
  } = options;

  const { publicClient, walletClient, address, isConnected, sendTransaction, waitForTransaction } = useWeb3();

  // State
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [totalAssets, setTotalAssets] = useState<bigint>(BigInt(0));
  const [totalSupply, setTotalSupply] = useState<bigint>(BigInt(0));
  const [riskScore, setRiskScore] = useState(0);
  const [riskStateIndex, setRiskStateIndex] = useState(0);
  const [userShares, setUserShares] = useState<bigint>(BigInt(0));
  const [maxDeposit, setMaxDeposit] = useState<bigint>(BigInt(0));
  const [maxWithdraw, setMaxWithdraw] = useState<bigint>(BigInt(0));
  const [usdcBalance, setUsdcBalance] = useState<bigint>(BigInt(0));
  const [usdcAllowance, setUsdcAllowance] = useState<bigint>(BigInt(0));
  
  const [isLoading, setIsLoading] = useState(true);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Computed values
  const sharePrice = useMemo(() => {
    if (totalSupply === BigInt(0)) return 1;
    return Number(totalAssets) / Number(totalSupply);
  }, [totalAssets, totalSupply]);

  const userAssets = useMemo(() => {
    return BigInt(Math.floor(Number(userShares) * sharePrice));
  }, [userShares, sharePrice]);

  const riskState = RISK_STATES[riskStateIndex] || 'NORMAL';

  // Formatted values
  const formattedTotalAssets = formatUnits(totalAssets, USDC_DECIMALS);
  const formattedUserShares = formatUnits(userShares, USDC_DECIMALS);
  const formattedUserAssets = formatUnits(userAssets, USDC_DECIMALS);
  const formattedUsdcBalance = formatUnits(usdcBalance, USDC_DECIMALS);

  // Fetch vault data
  const refresh = useCallback(async () => {
    if (!publicClient) return;

    setIsLoading(true);
    setError(null);

    try {
      const vault = getContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        client: publicClient,
      });

      const usdc = getContract({
        address: usdcAddress,
        abi: ERC20_ABI,
        client: publicClient,
      });

      // Batch read calls
      const [
        vaultName,
        vaultSymbol,
        assets,
        supply,
        risk,
        riskState,
      ] = await Promise.all([
        vault.read.name(),
        vault.read.symbol(),
        vault.read.totalAssets(),
        vault.read.totalSupply(),
        vault.read.riskScore(),
        vault.read.currentRiskState(),
      ]);

      setName(vaultName);
      setSymbol(vaultSymbol);
      setTotalAssets(assets);
      setTotalSupply(supply);
      setRiskScore(Number(risk));
      setRiskStateIndex(Number(riskState));

      // User-specific data
      if (address) {
        const [
          shares,
          maxDep,
          maxWith,
          balance,
          allowance,
        ] = await Promise.all([
          vault.read.balanceOf([address]),
          vault.read.maxDeposit([address]),
          vault.read.maxWithdraw([address]),
          usdc.read.balanceOf([address]),
          usdc.read.allowance([address, vaultAddress]),
        ]);

        setUserShares(shares);
        setMaxDeposit(maxDep);
        setMaxWithdraw(maxWith);
        setUsdcBalance(balance);
        setUsdcAllowance(allowance);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch vault data');
      setError(error);
      console.error('Vault fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [publicClient, vaultAddress, usdcAddress, address]);

  // Auto-refresh
  useEffect(() => {
    refresh();

    if (autoRefresh) {
      const interval = setInterval(refresh, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [refresh, autoRefresh, refreshInterval]);

  // Approve USDC
  const approve = useCallback(async (amount?: string): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setIsApproving(true);
    setError(null);

    try {
      const approveAmount = amount 
        ? parseUnits(amount, USDC_DECIMALS)
        : BigInt(2) ** BigInt(256) - BigInt(1); // Max approval

      const data = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vaultAddress, approveAmount],
      });

      const hash = await sendTransaction({
        to: usdcAddress,
        data,
      });

      await waitForTransaction(hash);
      await refresh();

      return hash;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Approval failed');
      setError(error);
      throw error;
    } finally {
      setIsApproving(false);
    }
  }, [walletClient, address, vaultAddress, usdcAddress, sendTransaction, waitForTransaction, refresh]);

  // Deposit
  const deposit = useCallback(async (amount: string): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setIsDepositing(true);
    setError(null);

    try {
      const assets = parseUnits(amount, USDC_DECIMALS);

      // Check allowance
      if (usdcAllowance < assets) {
        await approve(amount);
      }

      const data = encodeFunctionData({
        abi: VAULT_ABI,
        functionName: 'deposit',
        args: [assets, address],
      });

      const hash = await sendTransaction({
        to: vaultAddress,
        data,
      });

      await waitForTransaction(hash);
      await refresh();

      return hash;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Deposit failed');
      setError(error);
      throw error;
    } finally {
      setIsDepositing(false);
    }
  }, [walletClient, address, vaultAddress, usdcAllowance, approve, sendTransaction, waitForTransaction, refresh]);

  // Withdraw (by assets)
  const withdraw = useCallback(async (amount: string): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      const assets = parseUnits(amount, USDC_DECIMALS);

      const data = encodeFunctionData({
        abi: VAULT_ABI,
        functionName: 'withdraw',
        args: [assets, address, address],
      });

      const hash = await sendTransaction({
        to: vaultAddress,
        data,
      });

      await waitForTransaction(hash);
      await refresh();

      return hash;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Withdrawal failed');
      setError(error);
      throw error;
    } finally {
      setIsWithdrawing(false);
    }
  }, [walletClient, address, vaultAddress, sendTransaction, waitForTransaction, refresh]);

  // Redeem (by shares)
  const redeem = useCallback(async (shares: string): Promise<Hash> => {
    if (!walletClient || !address) {
      throw new Error('Wallet not connected');
    }

    setIsWithdrawing(true);
    setError(null);

    try {
      const shareAmount = parseUnits(shares, USDC_DECIMALS);

      const data = encodeFunctionData({
        abi: VAULT_ABI,
        functionName: 'redeem',
        args: [shareAmount, address, address],
      });

      const hash = await sendTransaction({
        to: vaultAddress,
        data,
      });

      await waitForTransaction(hash);
      await refresh();

      return hash;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Redemption failed');
      setError(error);
      throw error;
    } finally {
      setIsWithdrawing(false);
    }
  }, [walletClient, address, vaultAddress, sendTransaction, waitForTransaction, refresh]);

  // Preview deposit
  const previewDeposit = useCallback(async (amount: string): Promise<bigint> => {
    if (!publicClient) {
      throw new Error('Public client not initialized');
    }

    const vault = getContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      client: publicClient,
    });

    const assets = parseUnits(amount, USDC_DECIMALS);
    return vault.read.previewDeposit([assets]);
  }, [publicClient, vaultAddress]);

  // Preview redeem
  const previewRedeem = useCallback(async (shares: string): Promise<bigint> => {
    if (!publicClient) {
      throw new Error('Public client not initialized');
    }

    const vault = getContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      client: publicClient,
    });

    const shareAmount = parseUnits(shares, USDC_DECIMALS);
    return vault.read.previewRedeem([shareAmount]);
  }, [publicClient, vaultAddress]);

  return {
    // Vault info
    name,
    symbol,
    totalAssets,
    totalSupply,
    sharePrice,
    riskScore,
    riskState,
    
    // User position
    userShares,
    userAssets,
    maxDeposit,
    maxWithdraw,
    
    // USDC
    usdcBalance,
    usdcAllowance,
    
    // Loading states
    isLoading,
    isDepositing,
    isWithdrawing,
    isApproving,
    
    // Formatted values
    formattedTotalAssets,
    formattedUserShares,
    formattedUserAssets,
    formattedUsdcBalance,
    
    // Actions
    deposit,
    withdraw,
    redeem,
    approve,
    previewDeposit,
    previewRedeem,
    refresh,
    
    // Error
    error,
  };
}

export default useVault;
