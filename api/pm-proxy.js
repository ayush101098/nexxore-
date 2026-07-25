// Read-only proxy for Polymarket public APIs.
// Some ISPs (notably in India) block *.polymarket.com at DNS/SNI level, so the
// prediction terminal falls back to this route when direct calls fail.
const HOSTS = {
  gamma: 'https://gamma-api.polymarket.com',
  data: 'https://data-api.polymarket.com',
  clob: 'https://clob.polymarket.com'
};

const ALLOW = {
  gamma: ['/markets', '/events'],
  data: ['/trades', '/v1/leaderboard', '/value', '/positions', '/activity'],
  clob: ['/prices-history', '/book', '/midpoint']
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const m = url.pathname.match(/^\/api\/pm\/(gamma|data|clob)(\/[^?]*)$/);
  if (!m) return res.status(400).json({ error: 'Bad proxy path' });
  const host = m[1];
  const path = m[2];
  if (!ALLOW[host].some((p) => path === p || path.startsWith(p + '/'))) {
    return res.status(403).json({ error: 'Path not allowed' });
  }

  try {
    const upstream = await fetch(HOSTS[host] + path + url.search, {
      headers: { accept: 'application/json' }
    });
    const body = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    return res.status(upstream.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: 'Upstream unreachable', detail: e.message });
  }
};
