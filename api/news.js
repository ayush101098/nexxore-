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
    const news = await newsFetcher.fetchCryptoNews(
      ['crypto', 'defi', 'ethereum', 'aave', 'curve'],
      20
    );

    res.status(200).json({ news });
  } catch (err) {
    console.error('Error fetching news:', err);
    res.status(500).json({ error: err.message, news: [] });
  }
};
