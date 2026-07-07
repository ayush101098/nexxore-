/**
 * Combined site endpoints — one serverless function for lightweight routes.
 * Vercel's Hobby plan caps a deployment at 12 functions; waitlist and
 * track-record share this one to stay under the limit.
 *
 *   /api/waitlist      → POST email signups (Google Sheets)
 *   /api/track-record  → GET signal history + stats (Supabase / sample)
 */

const waitlist = require('./waitlist.js');
const trackRecord = require('./track-record.js');

module.exports = (req, res) => {
  const path = (req.url || '').split('?')[0];
  if (path.includes('waitlist')) return waitlist(req, res);
  return trackRecord(req, res);
};
