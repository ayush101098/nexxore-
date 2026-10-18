// Worker configuration. Everything comes from the environment; model IDs are
// never hard-coded (spec F1.2). Missing required values stop the worker at start.

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
function num(name, dflt) {
  const v = process.env[name];
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}

function load() {
  return {
    // Local runs write to a JSON file instead of Supabase
    ledgerFile: process.env.LEDGER_FILE || null,
    supabaseUrl: process.env.LEDGER_FILE ? null : req('SUPABASE_URL'),
    supabaseServiceKey: process.env.LEDGER_FILE ? null : req('SUPABASE_SERVICE_ROLE_KEY'),

    // Fitted calibration model (default: worker/model/calibration.json)
    calibrationFile: process.env.CALIBRATION_FILE || null,
    maxMarketsPerDay: num('MAX_MARKETS_PER_DAY', 200),
    callThresholdCents: num('CALL_THRESHOLD_CENTS', 3),
    minVolume24hUsd: num('MIN_VOLUME_24H_USD', 10000),
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', 5000),
    maxDaysToEnd: num('MAX_DAYS_TO_END', 90),
    reforecastHours: num('REFORECAST_HOURS', 6),
    reforecastMoveCents: num('REFORECAST_MOVE_CENTS', 5),

    forecastEveryMinutes: num('FORECAST_EVERY_MINUTES', 30),
    resolveEveryMinutes: num('RESOLVE_EVERY_MINUTES', 60),

    // Optional: private ops alerts for failed runs
    opsTelegramToken: process.env.OPS_TELEGRAM_BOT_TOKEN || null,
    opsTelegramChatId: process.env.OPS_TELEGRAM_CHAT_ID || null
  };
}

module.exports = { load };
