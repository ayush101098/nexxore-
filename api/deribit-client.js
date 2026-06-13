const DERIBIT_REST = process.env.DERIBIT_API_BASE || 'https://test.deribit.com/api/v2';

async function rpc(method, params) {
  const url = `${DERIBIT_REST}/${method}`;
  const query = new URLSearchParams(params || {}).toString();
  const res = await fetch(query ? `${url}?${query}` : url);
  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.error?.message || `Deribit ${method} failed`);
    err.code = data.error?.code || 'DERIBIT_UPSTREAM_ERROR';
    throw err;
  }
  return data.result;
}

async function auth(clientId, clientSecret) {
  return rpc('public/auth', {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret
  });
}

async function privateRpc(method, accessToken, params = {}) {
  return rpc(method, { ...params, access_token: accessToken });
}

async function getOrderBook(instrumentName) {
  return rpc('public/get_order_book', { instrument_name: instrumentName, depth: 20 });
}

module.exports = {
  auth,
  privateRpc,
  getOrderBook
};
