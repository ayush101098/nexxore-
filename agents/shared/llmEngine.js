/**
 * LLM Integration for Nexxore agents
 * Uses OpenAI to analyze news and generate trade opportunities
 */

const { AgentLogger } = require('./utils');

const logger = new AgentLogger('LLMEngine');

class LLMEngine {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || 'gpt-3.5-turbo';
    this.baseUrl = 'https://api.openai.com/v1';
    this.temperature = config.temperature || 0.7;
    
    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured');
    }
  }
  
  /**
   * Analyze news and extract trade opportunities
   */
  async analyzeNews(newsArticles = []) {
    if (newsArticles.length === 0) {
      return { opportunities: [], summary: 'No news to analyze' };
    }
    
    const newsText = newsArticles
      .map(article => `- ${article.title}: ${article.summary || article.description}`)
      .join('\n');
    
    const prompt = `You are a crypto trading analyst. Analyze the following news items and identify trading opportunities.

News:
${newsText}

For each opportunity, provide:
1. Protocol/Token name
2. Trade signal (BUY, SELL, HOLD)
3. Confidence level (1-10)
4. Reasoning

Format as JSON: { "opportunities": [{ "token": "", "signal": "", "confidence": 0, "reasoning": "" }] }`;
    
    try {
      const response = await this.callOpenAI(prompt);
      const parsed = JSON.parse(response);
      return {
        opportunities: parsed.opportunities || [],
        summary: this.generateSummary(parsed.opportunities),
        raw: response
      };
    } catch (err) {
      logger.error('Failed to analyze news with LLM', { error: err.message });
      return {
        opportunities: [],
        summary: 'Analysis failed',
        error: err.message
      };
    }
  }
  
  /**
   * Chat interface for user questions
   */
  async chat(userMessage, context = {}) {
    if (!this.apiKey) {
      return 'OpenAI API key not configured';
    }
    
    const systemPrompt = `You are a crypto market expert and DeFi analyst. 
You have access to latest news and on-chain data. 
Provide concise, actionable insights. Always remind users to DYOR.
${context.recentNews ? `\nRecent news context:\n${context.recentNews}` : ''}
${context.protocols ? `\nActive protocols: ${context.protocols.join(', ')}` : ''}`;
    
    try {
      const response = await this.callOpenAI(userMessage, systemPrompt);
      return response;
    } catch (err) {
      logger.error('Chat failed', { error: err.message });
      return `Error: ${err.message}`;
    }
  }
  
  /**
   * Generate trade signals from market data
   */
  async generateSignals(marketData = {}) {
    const prompt = `Analyze this market data and generate trading signals:

TVL Leaders: ${marketData.tvlLeaders?.join(', ') || 'N/A'}
Trending: ${marketData.trending?.join(', ') || 'N/A'}
New Launches: ${marketData.newLaunches?.join(', ') || 'N/A'}
Recent News: ${marketData.newsHeadlines?.slice(0, 3).join('; ') || 'N/A'}

Provide 3 actionable trade ideas with entry points and risk levels.`;
    
    try {
      const response = await this.callOpenAI(prompt);
      return response;
    } catch (err) {
      logger.error('Failed to generate signals', { error: err.message });
      return null;
    }
  }
  
  /**
   * Call OpenAI API
   */
  async callOpenAI(userMessage, systemMessage = null) {
    const messages = [];
    
    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }
    
    messages.push({ role: 'user', content: userMessage });
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: 1000
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  /**
   * Generate summary from opportunities
   */
  generateSummary(opportunities = []) {
    if (opportunities.length === 0) return 'No clear opportunities identified';
    
    const buys = opportunities.filter(o => o.signal === 'BUY').length;
    const sells = opportunities.filter(o => o.signal === 'SELL').length;
    const holds = opportunities.filter(o => o.signal === 'HOLD').length;
    
    return `Signals: ${buys} BUY, ${sells} SELL, ${holds} HOLD. Top opportunity: ${opportunities[0]?.token}`;
  }
}

module.exports = LLMEngine;
