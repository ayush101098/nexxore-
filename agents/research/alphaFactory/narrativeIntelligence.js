const DEFAULT_LIFECYCLE = {
  emerging: 6 * 60 * 60 * 1000,
  trending: 24 * 60 * 60 * 1000,
  established: 72 * 60 * 60 * 1000
};

const KEYWORD_CLUSTERS = [
  { id: 'ai_agents', keywords: ['ai', 'agent', 'agents', 'autonomous'] },
  { id: 'memecoins', keywords: ['meme', 'doge', 'pepe', 'cat'] },
  { id: 'depin', keywords: ['depin', 'infrastructure', 'iot'] },
  { id: 'rwa', keywords: ['rwa', 'real world assets'] },
  { id: 'gaming', keywords: ['game', 'gaming', 'play', 'metaverse'] },
  { id: 'l2s', keywords: ['l2', 'layer2', 'rollup'] }
];

class CookieNarrativeIntelligence {
  constructor() {
    this.history = new Map();
    this.clusterHistory = new Map();
  }

  _toKeywords(narrative) {
    if (!narrative) return [];
    if (Array.isArray(narrative)) return narrative.map(n => String(n).toLowerCase());
    return String(narrative).toLowerCase().split(/[,\s]+/).filter(Boolean);
  }

  _clusterToken(keywords) {
    const matched = KEYWORD_CLUSTERS.find(c => c.keywords.some(k => keywords.includes(k)));
    return matched ? matched.id : 'other';
  }

  _lifecycle(ageMs) {
    if (ageMs <= DEFAULT_LIFECYCLE.emerging) return 'emerging';
    if (ageMs <= DEFAULT_LIFECYCLE.trending) return 'trending';
    if (ageMs <= DEFAULT_LIFECYCLE.established) return 'established';
    return 'declining';
  }

  calculateVelocity(currentMentions, prevMentions, deltaHours) {
    if (!prevMentions || deltaHours <= 0) return 0;
    return (currentMentions - prevMentions) / deltaHours;
  }

  update(cookieItems = []) {
    const now = Date.now();
    const narratives = [];

    cookieItems.forEach(item => {
      const asset = item.asset;
      const prev = this.history.get(asset);
      const prevMentions = prev?.mentions || 0;
      const prevTime = prev?.timestamp ? new Date(prev.timestamp).getTime() : now - 3600000;
      const deltaHours = Math.max(1, (now - prevTime) / 3600000);

      const velocity = this.calculateVelocity(item.mentions || 0, prevMentions, deltaHours);
      const keywords = this._toKeywords(item.narrative);
      const cluster = this._clusterToken(keywords);
      const launchTime = item.launchTime ? new Date(item.launchTime).getTime() : prev?.launchTime || now;
      const lifecycle = this._lifecycle(now - launchTime);

      const narrativeRecord = {
        narrative_id: cluster,
        asset,
        velocity_score: Math.max(0, Math.min(1, (velocity + 10) / 20)),
        token_count: 1,
        sentiment_aggregate: item.sentiment || 0,
        confidence_level: item.confidence || 0.5,
        lifecycle,
        keywords
      };

      narratives.push(narrativeRecord);

      this.history.set(asset, {
        mentions: item.mentions || 0,
        timestamp: item.timestamp || new Date().toISOString(),
        launchTime
      });

      const prevCluster = this.clusterHistory.get(asset);
      if (prevCluster && prevCluster !== cluster) {
        narrativeRecord.pivot = { from: prevCluster, to: cluster };
      }
      this.clusterHistory.set(asset, cluster);
    });

    return this._aggregateClusters(narratives);
  }

  _aggregateClusters(narratives) {
    const clusterMap = new Map();
    narratives.forEach(n => {
      const entry = clusterMap.get(n.narrative_id) || {
        narrative_id: n.narrative_id,
        velocity_score: 0,
        token_count: 0,
        sentiment_aggregate: 0,
        confidence_level: 0,
        tokens: []
      };
      entry.velocity_score += n.velocity_score;
      entry.token_count += 1;
      entry.sentiment_aggregate += n.sentiment_aggregate;
      entry.confidence_level += n.confidence_level;
      entry.tokens.push(n.asset);
      clusterMap.set(n.narrative_id, entry);
    });

    return Array.from(clusterMap.values()).map(c => ({
      ...c,
      velocity_score: c.token_count ? c.velocity_score / c.token_count : 0,
      sentiment_aggregate: c.token_count ? c.sentiment_aggregate / c.token_count : 0,
      confidence_level: c.token_count ? c.confidence_level / c.token_count : 0
    }));
  }
}

module.exports = { CookieNarrativeIntelligence };
