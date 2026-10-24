/* Runs NXPerp.backtest off the main thread. Message in: { id, data, runs:[opts] };
   message out: { id, results:[...] } (trades trimmed to what the page renders). */
importScripts('/js/engines/core.js', '/js/engines/perp.js');
self.onmessage = function (e) {
  var m = e.data, out = [];
  try {
    m.runs.forEach(function (opts, i) {
      var r = NXPerp.backtest(m.data, opts);
      r.trades = r.trades.slice(-400);
      out.push(r);
      self.postMessage({ id: m.id, progress: (i + 1) / m.runs.length });
    });
    self.postMessage({ id: m.id, results: out });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};
