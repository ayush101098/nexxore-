const LLMEngine = require('../agents/shared/llmEngine');

const llmEngine = new LLMEngine({
  apiKey: process.env.OPENAI_API_KEY
});

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
    const { message, context } = req.body;
    
    // Use LLM to chat
    const response = await llmEngine.chat(message, context || {});
    
    res.status(200).json({ response });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(400).json({ error: err.message });
  }
};
