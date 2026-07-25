/**
 * Combined site endpoints — one serverless function for lightweight routes.
 * Vercel's Hobby plan caps a deployment at 12 functions; waitlist and
 * track-record share this one to stay under the limit.
 *
 *   /api/waitlist      → POST email signups (Google Sheets)
 *   /api/track-record  → GET signal history + stats (Supabase / sample)
 *   /api/pm/*          → read-only Polymarket proxy (ISP-block fallback)
 */

const waitlist = require('./waitlist.js');
const trackRecord = require('./track-record.js');
const pmProxy = require('./pm-proxy.js');

module.exports = (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path.startsWith('/api/pm/')) return pmProxy(req, res);
  if (path.includes('waitlist')) return waitlist(req, res);
  return trackRecord(req, res);
};
