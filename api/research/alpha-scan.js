/**
 * Alpha Scan API Endpoint
 * /api/research/alpha-scan.js
 * 
 * Returns tradeable signals from the alpha scanner
 */

// For serverless deployment (Vercel)
const { AlphaScanner } = require('../../agents/research/alphaScanner');

// In-memory cache for rate limiting
let lastScan = null;
let lastScanTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute cache

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { type, refresh } = req.query;
    
    // Check cache (unless refresh requested)
    if (!refresh && lastScan && (Date.now() - lastScanTime) < CACHE_TTL) {
      return res.status(200).json({
        ...lastScan,
        cached: true,
        cacheAge: Date.now() - lastScanTime
      });
    }
    
    const scanner = new AlphaScanner({
      minConfidence: 35,
      maxSignals: 15
    });
    
    let result;
    
    if (type) {
      // Scan specific type
      const signals = await scanner.scanType(type);
      result = {
        signals,
        summary: scanner.generateSummary(signals),
        scanType: type
      };
    } else {
      // Full scan
      result = await scanner.scan();
    }
    
    // Update cache
    lastScan = result;
    lastScanTime = Date.now();
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('Alpha scan error:', error);
    return res.status(500).json({
      error: 'Scan failed',
      message: error.message
    });
  }
};
