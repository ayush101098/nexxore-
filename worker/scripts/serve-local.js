// Local preview: serves the site and /api/track-record from LEDGER_FILE.
//   LEDGER_FILE=/path/ledger.json node worker/scripts/serve-local.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.argv[2] || 8766);
const trackRecord = require(path.join(ROOT, 'api/track-record.js'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/track-record') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; };
    res.send = (t) => { res.end(t); return res; };
    return trackRecord(req, res);
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!path.extname(p)) p += '.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/track-record (ledger: ${process.env.LEDGER_FILE})`));
