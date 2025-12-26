const RealNewsFetcher = require('../agents/shared/newsFetcher');

const newsFetcher = new RealNewsFetcher({
  newsApiKey: process.env.NEWS_API_KEY
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const trending = await newsFetcher.fetchTrendingTokens();
    res.status(200).json({ trending });
  } catch (err) {
    console.error('Error fetching trending:', err);
    res.status(500).json({ error: err.message, trending: [] });
  }
};
