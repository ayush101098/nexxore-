/**
 * Safe Yield API - Status Endpoint
 * Returns current vault status, metrics, and risk score
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Vault status data (will be dynamic when live)
    const status = {
      vault: {
        name: 'Safe Yield',
        type: 'Capital Preservation Vault',
        status: 'inactive', // inactive | live | restricted | paused
        version: '1.0.0',
        address: null, // Contract address when deployed
        network: 'ethereum',
        lastUpdate: new Date().toISOString()
      },
      
      metrics: {
        tvl: 0,
        tvlFormatted: '$0',
        currentApy: null,
        targetApy: { min: 3, max: 6 },
        targetVolatility: 2, // < 2%
        sharePrice: 1.0,
        totalShares: 0,
        depositors: 0
      },
      
      risk: {
        vaultRisk: 0.12,
        riskLevel: 'very-low', // very-low | low | medium | elevated | high | critical
        components: {
          protocol: 0.08,
          liquidity: 0.10,
          utilization: 0.12,
          governance: 0.08,
          oracle: 0.04
        },
        thresholds: {
          freezeRebalancing: 0.6,
          withdrawOnly: 0.7,
          emergencyUnwind: 0.8
        }
      },
      
      execution: {
        status: 'paused', // active | paused | frozen | emergency
        lastRebalance: null,
        nextRebalanceEligible: null,
        cooldownDays: 7,
        pendingActions: []
      },
      
      allocations: {
        current: {
          bluechipLending: 0,
          makerSdai: 0,
          stableLoop: 0,
          idle: 100
        },
        target: {
          bluechipLending: { min: 40, max: 70 },
          makerSdai: { min: 20, max: 40 },
          stableLoop: { min: 0, max: 20 },
          idle: { min: 5, max: 100 }
        }
      }
    };

    res.status(200).json(status);
  } catch (err) {
    console.error('Error fetching vault status:', err);
    res.status(500).json({ error: err.message });
  }
};
