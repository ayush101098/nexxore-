// Edge Engine worker: forecaster every FORECAST_EVERY_MINUTES, resolver every
// RESOLVE_EVERY_MINUTES. `--once forecast|resolve` runs a single pass and exits.
const { load } = require('./config');
const { makeDb } = require('./db');
const { makePolymarket } = require('./polymarket');
const { loadModel, makeCalibratedForecaster } = require('./model');
const { runForecast } = require('./forecaster');
const { runResolve } = require('./resolver');

const log = {
  info: (m) => console.log(`${new Date().toISOString()} ${m}`),
  error: (m) => console.error(`${new Date().toISOString()} ERROR ${m}`)
};

async function notifyOps(cfg, text) {
  if (!cfg.opsTelegramToken || !cfg.opsTelegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.opsTelegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.opsTelegramChatId, text: text.slice(0, 3500) })
    });
  } catch (e) { log.error(`ops alert failed: ${e.message}`); }
}

function guarded(name, cfg, fn) {
  let running = false;
  return async () => {
    if (running) { log.info(`${name}: previous run still going, skipping`); return; }
    running = true;
    try {
      const stats = await fn();
      log.info(`${name} done ${JSON.stringify(stats)}`);
      if (stats.errors > 0 || stats.stoppedBy === 'consecutive_failures') await notifyOps(cfg, `Nexxore ${name}: ${JSON.stringify(stats)}`);
    } catch (err) {
      log.error(`${name} run failed: ${err.stack || err.message}`);
      await notifyOps(cfg, `Nexxore ${name} run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
}

async function main() {
  const cfg = load();
  const db = cfg.ledgerFile
    ? require('./localdb').makeLocalDb(cfg.ledgerFile)
    : makeDb({ url: cfg.supabaseUrl, serviceKey: cfg.supabaseServiceKey });
  if (cfg.ledgerFile) log.info(`local ledger: ${cfg.ledgerFile}`);
  const pm = makePolymarket();
  const calibration = loadModel(cfg.calibrationFile);
  const model = makeCalibratedForecaster(calibration);
  log.info(`model ${calibration.version}: held-out Brier skill ${(calibration.heldOut.skill * 100).toFixed(2)}% vs market`);

  const forecast = guarded('forecast', cfg, () => runForecast({ cfg, pm, model, db, log }));
  const resolve = guarded('resolve', cfg, () => runResolve({ pm, db, log }));

  const once = process.argv.indexOf('--once');
  if (once !== -1) {
    await (process.argv[once + 1] === 'resolve' ? resolve : forecast)();
    return;
  }
  log.info(`worker started: forecast every ${cfg.forecastEveryMinutes}m, resolve every ${cfg.resolveEveryMinutes}m`);
  await resolve();
  await forecast();
  setInterval(forecast, cfg.forecastEveryMinutes * 60e3);
  setInterval(resolve, cfg.resolveEveryMinutes * 60e3);
}

main().catch((err) => { log.error(err.stack || err.message); process.exit(1); });
