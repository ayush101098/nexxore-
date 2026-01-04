/**
 * VaultDashboard React Component
 * Comprehensive dashboard showing vault stats, strategies, and user position
 */

import React, { useState, useEffect, useMemo } from 'react';
import { type Address, formatUnits } from 'viem';
import { useVault, type RiskState } from '../hooks/useVault';
import { useWeb3 } from '../hooks/useWeb3';

interface VaultDashboardProps {
  vaultAddress: Address;
  className?: string;
}

interface Strategy {
  address: string;
  name: string;
  allocation: number;
  balance: string;
  apy: number;
  utilization: number;
  isActive: boolean;
}

interface APYBreakdown {
  strategy: string;
  baseApy: number;
  rewardApy: number;
  totalApy: number;
  tvlShare: number;
}

// Risk state styling
const RISK_STYLES: Record<RiskState, { bg: string; text: string; border: string }> = {
  NORMAL: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  ELEVATED: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
  HIGH_RISK: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  CRITICAL: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export function VaultDashboard({ vaultAddress, className = '' }: VaultDashboardProps) {
  const { isConnected, address } = useWeb3();
  const vault = useVault({ vaultAddress });
  
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [apyBreakdown, setApyBreakdown] = useState<APYBreakdown[]>([]);
  const [netApy, setNetApy] = useState<number>(0);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'strategies' | 'history'>('overview');
  const [wsConnected, setWsConnected] = useState(false);

  // Fetch strategies and APY data
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        const [strategyRes, apyRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/vault/strategies`),
          fetch(`${API_BASE}/api/v1/vault/apy`),
        ]);

        if (strategyRes.ok) {
          const data = await strategyRes.json();
          setStrategies(data.map((s: any) => ({
            address: s.address,
            name: s.name,
            allocation: parseFloat(s.allocation_percent) / 100,
            balance: s.current_balance,
            apy: parseFloat(s.apy),
            utilization: parseFloat(s.utilization_rate),
            isActive: s.is_active,
          })));
        }

        if (apyRes.ok) {
          const data = await apyRes.json();
          setNetApy(parseFloat(data.net_apy));
          setApyBreakdown(data.breakdown.map((b: any) => ({
            strategy: b.strategy,
            baseApy: parseFloat(b.base_apy),
            rewardApy: parseFloat(b.reward_apy),
            totalApy: parseFloat(b.total_apy),
            tvlShare: parseFloat(b.tvl_share),
          })));
        }
      } catch (err) {
        console.error('Failed to fetch strategies:', err);
      } finally {
        setIsLoadingStrategies(false);
      }
    };

    fetchStrategies();
    const interval = setInterval(fetchStrategies, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  // WebSocket for real-time updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    
    const connectWs = () => {
      try {
        ws = new WebSocket(`${API_BASE.replace('http', 'ws')}/ws`);
        
        ws.onopen = () => {
          setWsConnected(true);
          ws?.send(JSON.stringify({ type: 'subscribe', channel: 'vault' }));
        };
        
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'vault_event') {
            vault.refresh();
          }
        };
        
        ws.onclose = () => {
          setWsConnected(false);
          setTimeout(connectWs, 5000);
        };
      } catch {
        setTimeout(connectWs, 5000);
      }
    };
    
    connectWs();
    return () => ws?.close();
  }, [vault]);

  // Calculate user PnL
  const userPnL = useMemo(() => {
    // This would come from the API in production
    return {
      value: 0,
      percent: 0,
    };
  }, []);

  const riskStyle = RISK_STYLES[vault.riskState];

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TVL Card */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-sm text-gray-500 mb-1">Total Value Locked</div>
          <div className="text-2xl font-bold">
            ${Number(vault.formattedTotalAssets).toLocaleString()}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {formatUnits(vault.totalSupply, 6)} {vault.symbol}
          </div>
        </div>

        {/* APY Card */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-sm text-gray-500 mb-1">Net APY</div>
          <div className="text-2xl font-bold text-green-600">
            {netApy.toFixed(2)}%
          </div>
          <div className="text-xs text-gray-400 mt-1">
            After {strategies.length} strategy fees
          </div>
        </div>

        {/* Risk Score Card */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-sm text-gray-500 mb-1">Risk Score</div>
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold">{(vault.riskScore / 100).toFixed(1)}%</div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${riskStyle.bg} ${riskStyle.text}`}>
              {vault.riskState}
            </span>
          </div>
          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all ${
                vault.riskScore < 6000 ? 'bg-green-500' :
                vault.riskScore < 7000 ? 'bg-yellow-500' :
                vault.riskScore < 8000 ? 'bg-orange-500' : 'bg-red-500'
              }`}
              style={{ width: `${vault.riskScore / 100}%` }}
            />
          </div>
        </div>

        {/* Share Price Card */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="text-sm text-gray-500 mb-1">Share Price</div>
          <div className="text-2xl font-bold">${vault.sharePrice.toFixed(4)}</div>
          <div className="text-xs text-gray-400 mt-1">
            1 {vault.symbol} = ${vault.sharePrice.toFixed(4)} USDC
          </div>
        </div>
      </div>

      {/* User Position (if connected) */}
      {isConnected && (
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-lg p-6 text-white">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-sm opacity-80 mb-1">Your Position</div>
              <div className="text-3xl font-bold">
                ${Number(vault.formattedUserAssets).toLocaleString()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm opacity-80 mb-1">P&L</div>
              <div className={`text-xl font-bold ${userPnL.value >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                {userPnL.value >= 0 ? '+' : ''}{userPnL.value.toFixed(2)} ({userPnL.percent.toFixed(2)}%)
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/20">
            <div>
              <div className="text-xs opacity-70">Shares</div>
              <div className="font-medium">{vault.formattedUserShares} {vault.symbol}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">USDC Balance</div>
              <div className="font-medium">{vault.formattedUsdcBalance}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">Est. Daily Yield</div>
              <div className="font-medium">
                ${(Number(vault.formattedUserAssets) * netApy / 36500).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow">
        <div className="border-b">
          <nav className="flex -mb-px">
            {(['overview', 'strategies', 'history'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 px-6 font-medium text-sm border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* APY Breakdown */}
              <div>
                <h3 className="text-lg font-semibold mb-4">APY Breakdown</h3>
                <div className="space-y-3">
                  {apyBreakdown.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-bold">{idx + 1}</span>
                        </div>
                        <div>
                          <div className="font-medium text-sm">
                            {item.strategy.slice(0, 6)}...{item.strategy.slice(-4)}
                          </div>
                          <div className="text-xs text-gray-500">{item.tvlShare.toFixed(1)}% TVL</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-green-600">{item.totalApy.toFixed(2)}%</div>
                        <div className="text-xs text-gray-500">
                          {item.baseApy.toFixed(1)}% + {item.rewardApy.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Risk Indicators */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Risk Indicators</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[
                    { label: 'Protocol', value: 35, max: 100 },
                    { label: 'Liquidity', value: 25, max: 100 },
                    { label: 'Utilization', value: 45, max: 100 },
                    { label: 'Governance', value: 20, max: 100 },
                    { label: 'Oracle', value: 15, max: 100 },
                  ].map((risk) => (
                    <div key={risk.label} className="text-center">
                      <div className="relative w-16 h-16 mx-auto mb-2">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle
                            cx="32"
                            cy="32"
                            r="28"
                            fill="none"
                            stroke="#e5e7eb"
                            strokeWidth="6"
                          />
                          <circle
                            cx="32"
                            cy="32"
                            r="28"
                            fill="none"
                            stroke={risk.value < 40 ? '#10b981' : risk.value < 60 ? '#f59e0b' : '#ef4444'}
                            strokeWidth="6"
                            strokeLinecap="round"
                            strokeDasharray={`${(risk.value / risk.max) * 176} 176`}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-bold">{risk.value}</span>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">{risk.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Strategies Tab */}
          {activeTab === 'strategies' && (
            <div>
              {isLoadingStrategies ? (
                <div className="text-center py-8 text-gray-500">Loading strategies...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase border-b">
                        <th className="pb-3 pr-4">Strategy</th>
                        <th className="pb-3 px-4">Allocation</th>
                        <th className="pb-3 px-4">Balance</th>
                        <th className="pb-3 px-4">APY</th>
                        <th className="pb-3 px-4">Utilization</th>
                        <th className="pb-3 pl-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {strategies.map((strategy) => (
                        <tr key={strategy.address} className="hover:bg-gray-50">
                          <td className="py-4 pr-4">
                            <div className="font-medium">{strategy.name}</div>
                            <div className="text-xs text-gray-500">
                              {strategy.address.slice(0, 6)}...{strategy.address.slice(-4)}
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500"
                                  style={{ width: `${strategy.allocation}%` }}
                                />
                              </div>
                              <span className="text-sm">{strategy.allocation.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            ${Number(formatUnits(BigInt(strategy.balance), 6)).toLocaleString()}
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-green-600 font-medium">{strategy.apy.toFixed(2)}%</span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full ${
                                    strategy.utilization < 0.8 ? 'bg-green-500' :
                                    strategy.utilization < 0.9 ? 'bg-yellow-500' : 'bg-red-500'
                                  }`}
                                  style={{ width: `${strategy.utilization * 100}%` }}
                                />
                              </div>
                              <span className="text-sm">{(strategy.utilization * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="py-4 pl-4">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              strategy.isActive 
                                ? 'bg-green-100 text-green-700' 
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {strategy.isActive ? 'Active' : 'Paused'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="text-center py-8 text-gray-500">
              <p>Transaction history coming soon...</p>
              <p className="text-sm mt-2">
                Connect to view your deposit and withdrawal history
              </p>
            </div>
          )}
        </div>
      </div>

      {/* WebSocket Status */}
      <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
        <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        {wsConnected ? 'Real-time updates active' : 'Reconnecting...'}
      </div>
    </div>
  );
}

export default VaultDashboard;
