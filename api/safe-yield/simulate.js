/**
 * Safe Yield API - Simulate Endpoint
 * Runs projection simulation based on user inputs
 */

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    
    await new Promise(resolve => req.on('end', resolve));
    
    const params = JSON.parse(body);
    const {
      depositAmount = 100000,
      timeHorizonMonths = 12,
      riskTolerance = 'conservative' // conservative | moderate
    } = params;

    // Validate inputs
    if (depositAmount < 0 || depositAmount > 1e12) {
      return res.status(400).json({ error: 'Invalid deposit amount' });
    }
    if (timeHorizonMonths < 1 || timeHorizonMonths > 120) {
      return res.status(400).json({ error: 'Time horizon must be 1-120 months' });
    }

    // Base parameters by risk tolerance
    const riskParams = {
      conservative: {
        expectedApy: 4.2,
        apyRange: [2.8, 5.6],
        volatility: 1.5,
        maxDrawdown: -0.8,
        riskScoreRange: [0.10, 0.18]
      },
      moderate: {
        expectedApy: 5.1,
        apyRange: [3.5, 6.8],
        volatility: 2.2,
        maxDrawdown: -1.5,
        riskScoreRange: [0.15, 0.28]
      }
    };

    const config = riskParams[riskTolerance] || riskParams.conservative;

    // Calculate projections
    const years = timeHorizonMonths / 12;
    const expectedValue = depositAmount * Math.pow(1 + config.expectedApy / 100, years);
    const bestCase = depositAmount * Math.pow(1 + config.apyRange[1] / 100, years);
    const worstCase = depositAmount * Math.pow(1 + config.apyRange[0] / 100, years);

    // Generate monthly projection path
    const projectionPath = [];
    let currentValue = depositAmount;
    const monthlyRate = config.expectedApy / 100 / 12;
    
    for (let month = 0; month <= timeHorizonMonths; month++) {
      // Add some realistic variance
      const variance = (Math.random() - 0.5) * config.volatility * 0.1;
      currentValue = currentValue * (1 + monthlyRate + variance / 100);
      
      projectionPath.push({
        month,
        value: Math.round(currentValue * 100) / 100,
        apy: config.expectedApy + variance
      });
    }

    const simulation = {
      inputs: {
        depositAmount,
        timeHorizonMonths,
        riskTolerance,
        timestamp: new Date().toISOString()
      },
      
      projections: {
        expectedApy: config.expectedApy,
        apyRange: {
          min: config.apyRange[0],
          max: config.apyRange[1]
        },
        
        expectedValue: Math.round(expectedValue * 100) / 100,
        valueRange: {
          best: Math.round(bestCase * 100) / 100,
          worst: Math.round(worstCase * 100) / 100
        },
        
        expectedProfit: Math.round((expectedValue - depositAmount) * 100) / 100,
        profitRange: {
          best: Math.round((bestCase - depositAmount) * 100) / 100,
          worst: Math.round((worstCase - depositAmount) * 100) / 100
        }
      },
      
      risk: {
        volatility: config.volatility,
        maxDrawdown: config.maxDrawdown,
        riskScoreTrajectory: {
          start: config.riskScoreRange[0],
          end: config.riskScoreRange[1],
          trend: 'stable'
        },
        sharpeRatio: (config.expectedApy - 2) / config.volatility // Assuming 2% risk-free rate
      },
      
      path: projectionPath,
      
      disclaimer: 'This simulation is for educational purposes only. It does not constitute financial advice and does not guarantee any returns. Actual results may vary significantly based on market conditions, protocol changes, and other factors.'
    };

    res.status(200).json(simulation);
  } catch (err) {
    console.error('Simulation error:', err);
    res.status(500).json({ error: err.message });
  }
};
