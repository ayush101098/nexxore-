// Simple chat response without OpenAI dependency
function generateChatResponse(message) {
  const lowerMessage = message.toLowerCase();
  
  // Simple keyword-based responses
  if (lowerMessage.includes('aave') || lowerMessage.includes('protocol')) {
    return 'AAVE is a leading DeFi lending protocol with over $33B in TVL. It offers flash loans, variable and stable interest rates, and supports multiple blockchain networks.';
  }
  
  if (lowerMessage.includes('defi') || lowerMessage.includes('decentralized')) {
    return 'DeFi (Decentralized Finance) refers to financial services built on blockchain technology. Major protocols include AAVE, Curve, Uniswap, and Compound. The total value locked across DeFi protocols exceeds $100B.';
  }
  
  if (lowerMessage.includes('tvl')) {
    return 'TVL (Total Value Locked) measures the total amount of assets deposited in a DeFi protocol. It\'s a key metric for assessing protocol size and health.';
  }
  
  if (lowerMessage.includes('curve') || lowerMessage.includes('stablecoin')) {
    return 'Curve Finance specializes in stablecoin swaps with low slippage. It\'s optimized for trading between similarly-priced assets like USDC, USDT, and DAI.';
  }
  
  if (lowerMessage.includes('uniswap') || lowerMessage.includes('dex')) {
    return 'Uniswap is the largest decentralized exchange (DEX) built on Ethereum. It uses an automated market maker (AMM) model for token swaps.';
  }
  
  return 'I can help you with information about DeFi protocols like AAVE, Curve, and Uniswap. Ask me about TVL, yields, or specific protocols!';
}

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
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const response = generateChatResponse(message);
    
    res.status(200).json({ response });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(400).json({ error: err.message });
  }
};
