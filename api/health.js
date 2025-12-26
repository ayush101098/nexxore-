module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.status(200).json({
    status: 'operational',
    timestamp: new Date().toISOString(),
    environment: 'vercel-serverless',
    agents: {
      research: {
        name: 'ResearchAgent',
        version: '1.0.0',
        type: 'research',
        status: 'active'
      },
      alpha: {
        name: 'AlphaDetectionAgent',
        version: '1.0.0',
        type: 'alpha_detection',
        status: 'active'
      }
    }
  });
};
