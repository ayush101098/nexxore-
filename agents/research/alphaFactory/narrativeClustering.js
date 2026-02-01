class NarrativeClusteringEngine {
  constructor(config = {}) {
    this.llm = config.llm || null;
    this.themeHistory = new Map();
    this.themes = [
      { id: 'ai_agents', label: 'AI Agents', keywords: ['ai', 'agent', 'agents', 'autonomous'] },
      { id: 'rwa', label: 'RWA', keywords: ['rwa', 'real world', 'treasury'] },
      { id: 'depin', label: 'DePIN', keywords: ['depin', 'infrastructure', 'iot'] },
      { id: 'memecoins', label: 'Memecoins', keywords: ['meme', 'doge', 'pepe', 'cat'] },
      { id: 'gaming', label: 'Gaming', keywords: ['game', 'gaming', 'metaverse'] },
      { id: 'l2s', label: 'L2s', keywords: ['l2', 'layer2', 'rollup'] }
    ];
  }

  _extractTokens(text = '') {
    return String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  }

  _matchTheme(tokens = []) {
    const theme = this.themes.find(t => t.keywords.some(k => tokens.includes(k)));
    return theme ? theme.id : 'other';
  }

  clusterNarratives({ cookieItems = [], socialMentions = [] } = {}) {
    const clusters = new Map();

    cookieItems.forEach(item => {
      const tokens = this._extractTokens([item.narrative, ...(item.tags || [])].join(' '));
      const themeId = this._matchTheme(tokens);
      const entry = clusters.get(themeId) || { themeId, tokens: new Set(), assets: new Set(), mentions: 0, velocity: 0 };
      entry.assets.add(item.asset);
      entry.mentions += item.mentions || 0;
      entry.velocity += item.velocity || 0;
      tokens.forEach(t => entry.tokens.add(t));
      clusters.set(themeId, entry);
    });

    socialMentions.forEach(mention => {
      const tokens = this._extractTokens(mention.text || '');
      const themeId = this._matchTheme(tokens);
      const entry = clusters.get(themeId) || { themeId, tokens: new Set(), assets: new Set(), mentions: 0, velocity: 0 };
      tokens.forEach(t => entry.tokens.add(t));
      clusters.set(themeId, entry);
    });

    return Array.from(clusters.values()).map(c => ({
      themeId: c.themeId,
      assets: Array.from(c.assets),
      tokenCount: c.assets.size,
      mentions: c.mentions,
      velocity: c.velocity,
      keywords: Array.from(c.tokens).slice(0, 12)
    }));
  }

  computeMomentum(cluster) {
    const now = Date.now();
    const prev = this.themeHistory.get(cluster.themeId) || { mentions: 0, velocity: 0, ts: now - 3600000 };
    const deltaHours = Math.max(1, (now - prev.ts) / 3600000);
    const mentionDelta = (cluster.mentions - prev.mentions) / Math.max(1, prev.mentions);
    const momentum = (mentionDelta * 0.6) + (cluster.velocity / Math.max(1, cluster.tokenCount) * 0.4);
    this.themeHistory.set(cluster.themeId, { mentions: cluster.mentions, velocity: cluster.velocity, ts: now });
    return Math.max(0, Math.min(1, (momentum + 1) / 2));
  }

  detectRotation(currentClusters = []) {
    const sorted = [...currentClusters].sort((a, b) => b.momentumScore - a.momentumScore);
    const top = sorted[0]?.themeId;
    const prevTop = this.lastTop;
    this.lastTop = top;
    if (prevTop && top && prevTop !== top) {
      return { from: prevTop, to: top };
    }
    return null;
  }

  analyze({ cookieItems = [], socialMentions = [] } = {}) {
    const clusters = this.clusterNarratives({ cookieItems, socialMentions });
    const enriched = clusters.map(c => ({
      ...c,
      momentumScore: this.computeMomentum(c)
    }));

    const rotation = this.detectRotation(enriched);
    return {
      themes: enriched.sort((a, b) => b.momentumScore - a.momentumScore).slice(0, 5),
      rotation
    };
  }
}

module.exports = { NarrativeClusteringEngine };
