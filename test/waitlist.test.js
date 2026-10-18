// /api/waitlist: validation, source column, RAW writes, env-JSON credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function load(appended, authArgs) {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'googleapis') {
      return { google: {
        auth: { GoogleAuth: function (opts) { authArgs.push(opts); this.getClient = async () => ({}); } },
        sheets: () => ({ spreadsheets: { values: { append: async (a) => { appended.push(a); return {}; } } } })
      } };
    }
    return orig.call(this, req, ...rest);
  };
  delete require.cache[require.resolve('../api/waitlist.js')];
  const h = require('../api/waitlist.js');
  Module._load = orig;
  return h;
}

function call(h, body, method = 'POST') {
  return new Promise((resolve) => {
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(this); return this; }, end() { resolve(this); return this; } };
    h({ method, body }, res);
  });
}

test('saves email with its source, RAW, using JSON credentials from env', async () => {
  process.env.GOOGLE_SHEET_ID = 'sheet';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com', private_key: 'k' });
  const appended = [], auth = [];
  const res = await call(load(appended, auth), { email: 'a@b.co', source: 'gate:prediction-terminal' });
  assert.equal(res.code, 200);
  assert.equal(auth[0].credentials.client_email, 'x@y.iam.gserviceaccount.com');
  assert.equal(appended[0].valueInputOption, 'RAW');
  assert.deepEqual(appended[0].resource.values[0].slice(0, 3), ['a@b.co', '', 'gate:prediction-terminal']);
});

test('rejects invalid email and strips odd characters from source', async () => {
  const appended = [];
  const h = load(appended, []);
  assert.equal((await call(h, { email: 'nope' })).code, 400);
  assert.equal((await call(h, { email: 'a@b' })).code, 400);
  await call(h, { email: 'a@b.co', source: '=HYPERLINK("x")' });
  assert.equal(appended[0].resource.values[0][2], 'HYPERLINKx');
});

test('not configured: clear error, nothing written', async () => {
  delete process.env.GOOGLE_SHEET_ID;
  const appended = [];
  const res = await call(load(appended, []), { email: 'a@b.co' });
  assert.equal(res.code, 500);
  assert.equal(res.body.error, 'Waitlist not configured');
  assert.equal(appended.length, 0);
});
