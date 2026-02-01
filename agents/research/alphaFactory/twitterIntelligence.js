const TOKEN_REGEX = /\$?[A-Z]{2,6}/g;

class TwitterIntelligence {
  constructor(config = {}) {
    this.accounts = config.accounts || [];
    this.tiers = config.tiers || { tier1: [], tier2: [], tier3: [] };
    this.tierWeights = { tier1: 3, tier2: 2, tier3: 1 };
  }

  categorizeAccount(handle) {
    if (this.tiers.tier1.includes(handle)) return 'tier1';
    if (this.tiers.tier2.includes(handle)) return 'tier2';
    return 'tier3';
  }

  extractEntities(text = '') {
    const matches = text.match(TOKEN_REGEX) || [];
    return Array.from(new Set(matches.map(m => m.replace('$', ''))));
  }

  sentimentHeuristic(text = '') {
    const lower = text.toLowerCase();
    const bullish = ['bull', 'bullish', 'long', 'buy', 'accumulate'];
    const bearish = ['bear', 'bearish', 'short', 'sell', 'dump'];
    let score = 0;
    bullish.forEach(w => { if (lower.includes(w)) score += 1; });
    bearish.forEach(w => { if (lower.includes(w)) score -= 1; });
    return score > 0 ? 0.7 : score < 0 ? -0.7 : 0;
  }

  computeMomentum(tweets = []) {
    const now = Date.now();
    return tweets.reduce((acc, t) => {
      const tier = this.categorizeAccount(t.author || '');
      const weight = this.tierWeights[tier] || 1;
      const engagement = (t.engagement?.like_count || 0) + (t.engagement?.retweet_count || 0) + (t.engagement?.reply_count || 0);
      const ageHours = Math.max(1, (now - new Date(t.timestamp).getTime()) / 3600000);
      const recency = Math.exp(-ageHours / 6);
      return acc + weight * (1 + Math.log1p(engagement)) * recency;
    }, 0);
  }

  filterBots(tweets = []) {
    return tweets.filter(t => {
      const engagement = (t.engagement?.like_count || 0) + (t.engagement?.retweet_count || 0) + (t.engagement?.reply_count || 0);
      if (engagement === 0) return false;
      if ((t.text || '').length < 8) return false;
      return true;
    });
  }

  groupThreads(tweets = []) {
    const byAuthor = new Map();
    tweets.forEach(t => {
      const key = t.author || 'unknown';
      const arr = byAuthor.get(key) || [];
      arr.push(t);
      byAuthor.set(key, arr);
    });
    return Array.from(byAuthor.values()).map(group => {
      const text = group.map(t => t.text).join(' ');
      return { ...group[0], text, threadSize: group.length };
    });
  }

  analyze(tweets = []) {
    const cleaned = this.filterBots(tweets);
    const threads = this.groupThreads(cleaned);

    const entities = threads.flatMap(t => this.extractEntities(t.text));
    const sentiment = threads.reduce((acc, t) => acc + this.sentimentHeuristic(t.text), 0) / Math.max(1, threads.length);

    const momentum = this.computeMomentum(threads);
    const uniqueAccounts = new Set(threads.map(t => t.author)).size;

    return {
      totalTweets: tweets.length,
      cleanedTweets: cleaned.length,
      uniqueAccounts,
      entities: Array.from(new Set(entities)),
      sentiment,
      socialMomentum: momentum
    };
  }
}

module.exports = { TwitterIntelligence };
