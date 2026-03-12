/* ═══════════════════════════════════════════════════════════
   NEXXORE TERMINAL v4 — DATA CACHE (LocalStorage + TTL)
   Instant reload, reduces API calls, smooth UX
   ═══════════════════════════════════════════════════════════ */

const NX_CACHE_PREFIX = 'nx_v4_';

const CACHE_TTL = {
  prices:    10 * 1000,     // 10s — WebSocket handles live, this is fallback
  ticker:    15 * 1000,     // 15s
  crypto:    30 * 1000,     // 30s
  fng:       120 * 1000,    // 2 min
  global:    60 * 1000,     // 1 min
  news:      120 * 1000,    // 2 min
  trending:  120 * 1000,    // 2 min
  macro:     600 * 1000,    // 10 min
  quakes:    300 * 1000,    // 5 min
  signals:   60 * 1000,     // 1 min
};

const NxCache = {
  set(key, data) {
    try {
      const entry = { data, ts: Date.now() };
      localStorage.setItem(NX_CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (e) {
      // Storage full — clear old entries
      this.prune();
    }
  },

  get(key, maxAge) {
    try {
      const raw = localStorage.getItem(NX_CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      const age = Date.now() - entry.ts;
      if (maxAge && age > maxAge) return null;
      return entry.data;
    } catch (e) {
      return null;
    }
  },

  has(key, maxAge) {
    return this.get(key, maxAge) !== null;
  },

  remove(key) {
    localStorage.removeItem(NX_CACHE_PREFIX + key);
  },

  prune() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NX_CACHE_PREFIX)) keys.push(k);
    }
    // Remove oldest half
    const entries = keys.map(k => {
      try { return { key: k, ts: JSON.parse(localStorage.getItem(k)).ts }; }
      catch { return { key: k, ts: 0 }; }
    }).sort((a, b) => a.ts - b.ts);
    const half = Math.ceil(entries.length / 2);
    entries.slice(0, half).forEach(e => localStorage.removeItem(e.key));
  },

  // Fetch with cache — returns cached data if fresh, otherwise fetches
  async fetch(key, ttl, fetchFn) {
    const cached = this.get(key, ttl);
    if (cached) return cached;
    try {
      const data = await fetchFn();
      if (data) this.set(key, data);
      return data;
    } catch (e) {
      // Return stale cache if fetch fails
      const stale = this.get(key);
      return stale || null;
    }
  },

  clearAll() {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NX_CACHE_PREFIX)) localStorage.removeItem(k);
    }
  }
};

// Export for use in terminal
if (typeof window !== 'undefined') window.NxCache = NxCache;
if (typeof window !== 'undefined') window.CACHE_TTL = CACHE_TTL;
