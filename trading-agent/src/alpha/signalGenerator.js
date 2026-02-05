// Alpha Signal Generator - Core signal generation logic
import axios from 'axios';
import config from '../config.js';
import db from '../data/database.js';
import crypto from 'crypto';

class SignalGenerator {
  constructor() {
    this.priceData = {};
    this.marketData = {};
    this.indicators = {};
  }

  // Fetch all required data for signal generation
  async fetchMarketData(asset) {
    try {
      const symbol = `${asset}USDT`;
      
      // Fetch current price and 24h data
      const [tickerRes, klinesRes] = await Promise.all([
        axios.get(`${config.apis.binance}/ticker/24hr?symbol=${symbol}`),
        axios.get(`${config.apis.binance}/klines?symbol=${symbol}&interval=1d&limit=30`)
      ]);

      const ticker = tickerRes.data;
      const klines = klinesRes.data;

      // Calculate support/resistance from recent data
      const sr = this.calculateSupportResistance(klines);
      
      // Store market data
      this.marketData[asset] = {
        price: parseFloat(ticker.lastPrice),
        change24h: parseFloat(ticker.priceChangePercent),
        volume24h: parseFloat(ticker.volume) * parseFloat(ticker.lastPrice),
        high24h: parseFloat(ticker.highPrice),
        low24h: parseFloat(ticker.lowPrice),
        ...sr
      };

      return this.marketData[asset];
    } catch (error) {
      console.error(`Error fetching market data for ${asset}:`, error.message);
      return null;
    }
  }

  // Calculate support and resistance levels using pivot points
  calculateSupportResistance(klines) {
    if (!klines || klines.length < 2) return {};
    
    const prev = klines[klines.length - 2];
    const high = parseFloat(prev[2]);
    const low = parseFloat(prev[3]);
    const close = parseFloat(prev[4]);
    
    const pivot = (high + low + close) / 3;
    const r1 = (2 * pivot) - low;
    const r2 = pivot + (high - low);
    const r3 = high + 2 * (pivot - low);
    const s1 = (2 * pivot) - high;
    const s2 = pivot - (high - low);
    const s3 = low - 2 * (high - pivot);
    
    return { pivot, r1, r2, r3, s1, s2, s3 };
  }

  // Calculate technical score (0-100)
  async calculateTechnicalScore(asset, data) {
    let score = 50;
    const signals = [];
    
    const { price, high24h, low24h, change24h, pivot, r1, s1 } = data;
    
    // Price position relative to pivot
    if (price < pivot && price > s1) {
      score += 10;
      signals.push({ type: 'bullish', text: 'Price above S1, room to move up' });
    } else if (price > pivot && price < r1) {
      score -= 5;
      signals.push({ type: 'neutral', text: 'Price between pivot and R1' });
    }
    
    // Near support (bullish)
    const distToS1 = Math.abs(price - s1) / price;
    if (distToS1 < 0.02) {
      score += 20;
      signals.push({ type: 'bullish', text: `Near S1 support (${(distToS1 * 100).toFixed(2)}% away)` });
    }
    
    // RSI approximation
    const pricePosition = ((price - low24h) / (high24h - low24h)) * 100;
    const rsi = 30 + (pricePosition * 0.4);
    
    if (rsi < 30) {
      score += 25;
      signals.push({ type: 'bullish', text: `Oversold (RSI ~${rsi.toFixed(0)})` });
    } else if (rsi > 70) {
      score -= 20;
      signals.push({ type: 'bearish', text: `Overbought (RSI ~${rsi.toFixed(0)})` });
    }
    
    // Momentum
    if (change24h > 5) {
      score += 10;
      signals.push({ type: 'bullish', text: `Strong momentum (+${change24h.toFixed(2)}%)` });
    } else if (change24h < -5) {
      score -= 10;
      signals.push({ type: 'bearish', text: `Weak momentum (${change24h.toFixed(2)}%)` });
    }
    
    return { score: Math.min(100, Math.max(0, score)), signals, rsi };
  }

  // Calculate on-chain score (0-100)
  async calculateOnChainScore(asset) {
    let score = 50;
    const signals = [];
    
    try {
      // Simulate on-chain metrics (in production, use real APIs)
      // These would come from Glassnode, CryptoQuant, etc.
      
      const metrics = {
        exchangeNetflow: Math.random() * 2 - 1, // -1 to 1 (negative = outflow = bullish)
        whaleAccumulation: Math.random() > 0.5,
        dormantCoinsMoving: Math.random() > 0.8,
        activeAddresses: Math.random() > 0.5 ? 'increasing' : 'decreasing'
      };
      
      // Exchange netflow
      if (metrics.exchangeNetflow < -0.3) {
        score += 15;
        signals.push({ type: 'bullish', text: 'Net exchange outflows (accumulation)' });
      } else if (metrics.exchangeNetflow > 0.3) {
        score -= 15;
        signals.push({ type: 'bearish', text: 'Net exchange inflows (distribution)' });
      }
      
      // Whale accumulation
      if (metrics.whaleAccumulation) {
        score += 15;
        signals.push({ type: 'bullish', text: 'Whale wallets accumulating' });
      }
      
      // Dormant coins
      if (metrics.dormantCoinsMoving) {
        score -= 10;
        signals.push({ type: 'warning', text: 'Dormant coins moving (potential selling)' });
      }
      
      // Active addresses
      if (metrics.activeAddresses === 'increasing') {
        score += 10;
        signals.push({ type: 'bullish', text: 'Active addresses increasing' });
      }
      
    } catch (error) {
      console.error('On-chain analysis error:', error.message);
    }
    
    return { score: Math.min(100, Math.max(0, score)), signals };
  }

  // Calculate derivatives score (0-100)
  async calculateDerivativesScore(asset) {
    let score = 50;
    const signals = [];
    
    try {
      // Simulate derivatives data (would come from exchange APIs)
      const metrics = {
        fundingRate: (Math.random() - 0.5) * 0.1,
        openInterestChange: (Math.random() - 0.5) * 20,
        longShortRatio: 0.8 + Math.random() * 0.4,
        liquidations24h: Math.random() * 100
      };
      
      // Funding rate
      if (metrics.fundingRate < -0.01) {
        score += 20;
        signals.push({ type: 'bullish', text: `Negative funding (${(metrics.fundingRate * 100).toFixed(3)}%) - shorts paying` });
      } else if (metrics.fundingRate > 0.02) {
        score -= 15;
        signals.push({ type: 'bearish', text: `High funding (${(metrics.fundingRate * 100).toFixed(3)}%) - longs crowded` });
      }
      
      // Open interest
      if (metrics.openInterestChange > 10) {
        score += 5;
        signals.push({ type: 'info', text: `OI increasing ${metrics.openInterestChange.toFixed(1)}%` });
      }
      
      // Long/short ratio
      if (metrics.longShortRatio < 0.9) {
        score += 15;
        signals.push({ type: 'bullish', text: 'Shorts crowded - squeeze potential' });
      } else if (metrics.longShortRatio > 1.15) {
        score -= 10;
        signals.push({ type: 'bearish', text: 'Longs crowded - liquidation risk' });
      }
      
    } catch (error) {
      console.error('Derivatives analysis error:', error.message);
    }
    
    return { score: Math.min(100, Math.max(0, score)), signals };
  }

  // Calculate sentiment score (0-100)
  async calculateSentimentScore() {
    let score = 50;
    const signals = [];
    
    try {
      // Fetch Fear & Greed Index
      const fgRes = await axios.get(`${config.apis.fearGreed}/?limit=1`);
      const fgValue = parseInt(fgRes.data.data[0].value);
      
      // Contrarian approach
      if (fgValue < 25) {
        score += 25;
        signals.push({ type: 'bullish', text: `Extreme Fear (${fgValue}) - contrarian buy` });
      } else if (fgValue < 40) {
        score += 15;
        signals.push({ type: 'bullish', text: `Fear (${fgValue}) - favorable for longs` });
      } else if (fgValue > 75) {
        score -= 20;
        signals.push({ type: 'bearish', text: `Extreme Greed (${fgValue}) - caution advised` });
      } else if (fgValue > 60) {
        score -= 10;
        signals.push({ type: 'bearish', text: `Greed (${fgValue}) - getting extended` });
      }
      
    } catch (error) {
      console.error('Sentiment analysis error:', error.message);
    }
    
    return { score: Math.min(100, Math.max(0, score)), signals };
  }

  // Generate full signal for an asset
  async generateSignal(asset) {
    console.log(`🔍 Generating signal for ${asset}...`);
    
    // Fetch market data
    const marketData = await this.fetchMarketData(asset);
    if (!marketData) {
      console.log(`❌ Could not fetch market data for ${asset}`);
      return null;
    }
    
    // Calculate all scores
    const [technical, onChain, derivatives, sentiment] = await Promise.all([
      this.calculateTechnicalScore(asset, marketData),
      this.calculateOnChainScore(asset),
      this.calculateDerivativesScore(asset),
      this.calculateSentimentScore()
    ]);
    
    // Calculate weighted confluence score
    const confluenceScore = Math.round(
      (onChain.score * 0.30) +
      (technical.score * 0.25) +
      (derivatives.score * 0.25) +
      (sentiment.score * 0.20)
    );
    
    // Determine direction
    const direction = confluenceScore >= 55 ? 'LONG' : confluenceScore <= 45 ? 'SHORT' : null;
    
    if (!direction) {
      console.log(`⚖️ ${asset}: Confluence score ${confluenceScore} - no clear direction`);
      return null;
    }
    
    // Check minimum threshold
    if (confluenceScore < config.signals.minConfluenceScore) {
      console.log(`📉 ${asset}: Confluence ${confluenceScore} below threshold ${config.signals.minConfluenceScore}`);
      return null;
    }
    
    // Calculate entry, stop, and targets
    const { price, s1, s2, r1, r2, pivot } = marketData;
    
    let entry, stopLoss, tp1, tp2, tp3;
    
    if (direction === 'LONG') {
      entry = price;
      stopLoss = s2 * 0.995; // Just below S2
      tp1 = r1;
      tp2 = r2;
      tp3 = r2 * 1.02;
    } else {
      entry = price;
      stopLoss = r2 * 1.005; // Just above R2
      tp1 = s1;
      tp2 = s2;
      tp3 = s2 * 0.98;
    }
    
    // Calculate risk/reward
    const riskPercent = Math.abs(entry - stopLoss) / entry;
    const rewardPercent = Math.abs(tp2 - entry) / entry;
    const riskReward = rewardPercent / riskPercent;
    
    // Skip if R:R is too low
    if (riskReward < 2.0) {
      console.log(`📊 ${asset}: R:R ${riskReward.toFixed(2)} too low (min 2.0)`);
      return null;
    }
    
    // Build signal object
    const signal = {
      id: `SIG-${Date.now()}-${asset}`,
      asset,
      direction,
      confluenceScore,
      alphaScore: confluenceScore,
      onChainScore: onChain.score,
      technicalScore: technical.score,
      derivativesScore: derivatives.score,
      sentimentScore: sentiment.score,
      currentPrice: price,
      support1: s1,
      support2: s2,
      resistance1: r1,
      resistance2: r2,
      pivot,
      suggestedEntry: entry,
      suggestedStop: stopLoss,
      suggestedTp1: tp1,
      suggestedTp2: tp2,
      suggestedTp3: tp3,
      riskReward,
      riskPercent: riskPercent * 100,
      reasoning: this.buildReasoning(direction, technical, onChain, derivatives, sentiment),
      signals: {
        technical: technical.signals,
        onChain: onChain.signals,
        derivatives: derivatives.signals,
        sentiment: sentiment.signals
      },
      validUntil: new Date(Date.now() + 4 * 60 * 60 * 1000), // Valid for 4 hours
      timestamp: new Date()
    };
    
    // Save to database
    this.saveSignal(signal);
    
    console.log(`✅ ${asset} ${direction} signal generated: Confluence ${confluenceScore}, R:R ${riskReward.toFixed(2)}`);
    
    return signal;
  }

  // Build human-readable reasoning
  buildReasoning(direction, technical, onChain, derivatives, sentiment) {
    const reasons = [];
    
    if (technical.score > 60) {
      reasons.push(`Technical setup is ${direction === 'LONG' ? 'bullish' : 'bearish'} (${technical.score}/100)`);
    }
    if (onChain.score > 60) {
      reasons.push(`On-chain data supports ${direction.toLowerCase()} positioning (${onChain.score}/100)`);
    }
    if (derivatives.score > 60) {
      reasons.push(`Derivatives market favors ${direction.toLowerCase()}s (${derivatives.score}/100)`);
    }
    if (sentiment.score > 60 || sentiment.score < 40) {
      reasons.push(`Sentiment is ${sentiment.score > 60 ? 'contrarian buy' : 'contrarian sell'} zone (${sentiment.score}/100)`);
    }
    
    return reasons.join('. ');
  }

  // Save signal to database
  saveSignal(signal) {
    try {
      db.prepare(`
        INSERT INTO signals (
          asset, direction, confluence_score, alpha_score,
          on_chain_score, technical_score, derivatives_score, sentiment_score,
          current_price, support_1, support_2, resistance_1, resistance_2, pivot,
          suggested_entry, suggested_stop, suggested_tp1, suggested_tp2, suggested_tp3,
          risk_reward, reasoning, valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        signal.asset, signal.direction, signal.confluenceScore, signal.alphaScore,
        signal.onChainScore, signal.technicalScore, signal.derivativesScore, signal.sentimentScore,
        signal.currentPrice, signal.support1, signal.support2, signal.resistance1, signal.resistance2, signal.pivot,
        signal.suggestedEntry, signal.suggestedStop, signal.suggestedTp1, signal.suggestedTp2, signal.suggestedTp3,
        signal.riskReward, signal.reasoning, signal.validUntil.toISOString()
      );
    } catch (error) {
      console.error('Error saving signal:', error.message);
    }
  }

  // Scan all assets for signals
  async scanAllAssets() {
    console.log('\n🔄 Scanning all assets for signals...');
    const signals = [];
    
    for (const asset of config.assets) {
      try {
        const signal = await this.generateSignal(asset);
        if (signal) {
          signals.push(signal);
        }
        // Small delay between assets
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.error(`Error scanning ${asset}:`, error.message);
      }
    }
    
    console.log(`📊 Scan complete: ${signals.length} signals generated\n`);
    return signals;
  }

  // Get best signal (highest confluence)
  getBestSignal(signals) {
    if (!signals || signals.length === 0) return null;
    return signals.sort((a, b) => b.confluenceScore - a.confluenceScore)[0];
  }
}

export default SignalGenerator;
