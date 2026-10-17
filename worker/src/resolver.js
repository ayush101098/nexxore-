// Hourly resolver (spec F2.5–F2.6): settle open ledger rows from Polymarket.
async function runResolve({ pm, db, log }) {
  const stats = { checked: 0, resolved: 0, void: 0, errors: 0 };
  for (const id of await db.openMarketIds()) {
    stats.checked++;
    try {
      const r = await pm.resolution(id);
      if (r.state === 'resolved') {
        await db.resolveMarket(id, { status: 'resolved', resolvedYes: r.yes, resolvedAt: r.at });
        stats.resolved++;
      } else if (r.state === 'void') {
        await db.resolveMarket(id, { status: 'void', resolvedYes: null, resolvedAt: r.at });
        stats.void++;
      }
    } catch (err) {
      stats.errors++;
      log.error(`resolve failed ${id}: ${err.message}`);
    }
  }
  return stats;
}

module.exports = { runResolve };
