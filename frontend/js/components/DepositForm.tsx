/**
 * DepositForm React Component
 * Handles USDC deposits into the SafeYield Vault
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { formatUnits, parseUnits, type Address } from 'viem';
import { useVault, type RiskState } from '../hooks/useVault';
import { useWeb3 } from '../hooks/useWeb3';

interface DepositFormProps {
  vaultAddress: Address;
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
  className?: string;
}

const USDC_DECIMALS = 6;
const MIN_DEPOSIT = 1; // 1 USDC minimum
const QUICK_AMOUNTS = ['100', '500', '1000', '5000'];

// Risk state colors and messages
const RISK_CONFIG: Record<RiskState, { color: string; bgColor: string; message: string }> = {
  NORMAL: { 
    color: 'text-green-600', 
    bgColor: 'bg-green-50 border-green-200', 
    message: 'Vault operating normally' 
  },
  ELEVATED: { 
    color: 'text-yellow-600', 
    bgColor: 'bg-yellow-50 border-yellow-200', 
    message: 'Elevated risk - deposits allowed with caution' 
  },
  HIGH_RISK: { 
    color: 'text-orange-600', 
    bgColor: 'bg-orange-50 border-orange-200', 
    message: 'High risk - consider waiting for conditions to improve' 
  },
  CRITICAL: { 
    color: 'text-red-600', 
    bgColor: 'bg-red-50 border-red-200', 
    message: 'Critical risk - deposits may be disabled' 
  },
};

export function DepositForm({ vaultAddress, onSuccess, onError, className = '' }: DepositFormProps) {
  const { isConnected, address, connect, isCorrectNetwork, switchNetwork, chainId } = useWeb3();
  const vault = useVault({ vaultAddress });
  
  const [amount, setAmount] = useState('');
  const [previewShares, setPreviewShares] = useState<bigint | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Parse amount
  const parsedAmount = useMemo(() => {
    try {
      return amount ? parseUnits(amount, USDC_DECIMALS) : BigInt(0);
    } catch {
      return BigInt(0);
    }
  }, [amount]);

  // Validation
  const validationError = useMemo(() => {
    if (!amount) return null;
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return 'Invalid amount';
    if (numAmount < MIN_DEPOSIT) return `Minimum deposit is ${MIN_DEPOSIT} USDC`;
    if (parsedAmount > vault.usdcBalance) return 'Insufficient USDC balance';
    if (parsedAmount > vault.maxDeposit) return 'Amount exceeds max deposit';
    if (vault.riskState === 'CRITICAL') return 'Deposits disabled during critical risk';
    
    return null;
  }, [amount, parsedAmount, vault.usdcBalance, vault.maxDeposit, vault.riskState]);

  const isValid = !!amount && !validationError && parsedAmount > BigInt(0);

  // Preview shares on amount change
  useEffect(() => {
    if (!isValid || parsedAmount === BigInt(0)) {
      setPreviewShares(null);
      return;
    }

    let cancelled = false;
    setIsPreviewLoading(true);

    vault.previewDeposit(amount)
      .then(shares => {
        if (!cancelled) {
          setPreviewShares(shares);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) {
          setIsPreviewLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [amount, isValid, parsedAmount, vault]);

  // Handle deposit
  const handleDeposit = useCallback(async () => {
    if (!isValid) return;

    try {
      const txHash = await vault.deposit(amount);
      setAmount('');
      setShowConfirm(false);
      onSuccess?.(txHash);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Deposit failed');
      onError?.(error);
    }
  }, [amount, isValid, vault, onSuccess, onError]);

  // Handle max button
  const handleMax = useCallback(() => {
    const maxAmount = formatUnits(vault.usdcBalance, USDC_DECIMALS);
    setAmount(maxAmount);
  }, [vault.usdcBalance]);

  // Handle quick amount buttons
  const handleQuickAmount = useCallback((quickAmount: string) => {
    setAmount(quickAmount);
  }, []);

  // Calculate estimated APY gain
  const estimatedAPY = useMemo(() => {
    if (!amount || !previewShares) return null;
    // This would come from the APY API in production
    return '5.2'; // Placeholder
  }, [amount, previewShares]);

  // Risk indicator
  const riskConfig = RISK_CONFIG[vault.riskState];

  // Not connected state
  if (!isConnected) {
    return (
      <div className={`bg-white rounded-xl shadow-lg p-6 ${className}`}>
        <h2 className="text-xl font-semibold mb-4">Deposit USDC</h2>
        <div className="text-center py-8">
          <p className="text-gray-500 mb-4">Connect your wallet to deposit</p>
          <button
            onClick={() => connect('injected')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  // Wrong network state
  if (!isCorrectNetwork) {
    return (
      <div className={`bg-white rounded-xl shadow-lg p-6 ${className}`}>
        <h2 className="text-xl font-semibold mb-4">Deposit USDC</h2>
        <div className="text-center py-8">
          <p className="text-gray-500 mb-4">Please switch to the correct network</p>
          <button
            onClick={() => switchNetwork(1)} // Mainnet
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Switch to Ethereum
          </button>
        </div>
      </div>
    );
  }

  // Confirmation modal
  if (showConfirm) {
    return (
      <div className={`bg-white rounded-xl shadow-lg p-6 ${className}`}>
        <h2 className="text-xl font-semibold mb-4">Confirm Deposit</h2>
        
        <div className="space-y-4 mb-6">
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Deposit Amount</span>
            <span className="font-medium">{amount} USDC</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Shares Received</span>
            <span className="font-medium">
              {previewShares ? formatUnits(previewShares, USDC_DECIMALS) : '-'} {vault.symbol}
            </span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-500">Share Price</span>
            <span className="font-medium">${vault.sharePrice.toFixed(4)}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-500">Est. APY</span>
            <span className="font-medium text-green-600">{estimatedAPY}%</span>
          </div>
        </div>

        {/* Risk Warning */}
        {vault.riskState !== 'NORMAL' && (
          <div className={`${riskConfig.bgColor} border rounded-lg p-3 mb-4`}>
            <p className={`text-sm ${riskConfig.color}`}>
              ⚠️ {riskConfig.message}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setShowConfirm(false)}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDeposit}
            disabled={vault.isDepositing || vault.isApproving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-3 rounded-lg transition-colors"
          >
            {vault.isApproving ? 'Approving...' : vault.isDepositing ? 'Depositing...' : 'Confirm Deposit'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl shadow-lg p-6 ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Deposit USDC</h2>
        <div className={`px-2 py-1 rounded text-xs font-medium ${riskConfig.bgColor} ${riskConfig.color}`}>
          {vault.riskState}
        </div>
      </div>

      {/* Risk Banner */}
      {vault.riskState !== 'NORMAL' && (
        <div className={`${riskConfig.bgColor} border rounded-lg p-3 mb-4`}>
          <p className={`text-sm ${riskConfig.color}`}>
            {riskConfig.message}
          </p>
        </div>
      )}

      {/* Balance Display */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <div className="flex justify-between text-sm text-gray-500 mb-1">
          <span>Your USDC Balance</span>
          <span>Available to deposit</span>
        </div>
        <div className="flex justify-between">
          <span className="text-lg font-medium">{vault.formattedUsdcBalance} USDC</span>
          <span className="text-sm text-gray-500">
            Max: {formatUnits(vault.maxDeposit, USDC_DECIMALS)} USDC
          </span>
        </div>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Deposit Amount
        </label>
        <div className="relative">
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.00"
            className={`w-full border rounded-lg py-3 px-4 pr-20 text-lg font-medium focus:outline-none focus:ring-2 ${
              validationError 
                ? 'border-red-300 focus:ring-red-500' 
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          <button
            onClick={handleMax}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600 hover:text-blue-700 font-medium text-sm"
          >
            MAX
          </button>
        </div>
        {validationError && (
          <p className="mt-1 text-sm text-red-600">{validationError}</p>
        )}
      </div>

      {/* Quick Amount Buttons */}
      <div className="flex gap-2 mb-4">
        {QUICK_AMOUNTS.map((quickAmount) => (
          <button
            key={quickAmount}
            onClick={() => handleQuickAmount(quickAmount)}
            className="flex-1 py-2 px-3 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ${quickAmount}
          </button>
        ))}
      </div>

      {/* Preview */}
      {isValid && (
        <div className="bg-blue-50 rounded-lg p-4 mb-4">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600">You will receive</span>
            <span className="font-medium">
              {isPreviewLoading ? (
                <span className="text-gray-400">Calculating...</span>
              ) : previewShares ? (
                `${formatUnits(previewShares, USDC_DECIMALS)} ${vault.symbol}`
              ) : (
                '-'
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-600">Share Price</span>
            <span className="font-medium">${vault.sharePrice.toFixed(4)}</span>
          </div>
        </div>
      )}

      {/* Deposit Button */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={!isValid || vault.isLoading || vault.riskState === 'CRITICAL'}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
      >
        {vault.isLoading ? 'Loading...' : 'Review Deposit'}
      </button>

      {/* Error Display */}
      {vault.error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-600">{vault.error.message}</p>
        </div>
      )}

      {/* Vault Info */}
      <div className="mt-6 pt-4 border-t">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-500">Total Vault TVL</span>
          <span className="font-medium">${vault.formattedTotalAssets}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Risk Score</span>
          <span className={`font-medium ${riskConfig.color}`}>
            {vault.riskScore / 100}%
          </span>
        </div>
      </div>
    </div>
  );
}

export default DepositForm;
