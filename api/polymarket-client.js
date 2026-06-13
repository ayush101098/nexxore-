const CLOB_API = 'https://clob.polymarket.com';

async function clob(path, options = {}) {
  const res = await fetch(`${CLOB_API}${path}`, options);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || data?.message || `Polymarket error ${res.status}`);
  return data;
}

function authHeaders(credential) {
  // Keep generic to support different header schemes.
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${credential.l2Key || credential.apiKey || ''}`,
    'X-Polymarket-Address': credential.walletAddress || ''
  };
}

async function getBook(tokenId) {
  return clob(`/book?token_id=${encodeURIComponent(tokenId)}`);
}

async function placeOrder(credential, payload) {
  return clob('/order', {
    method: 'POST',
    headers: authHeaders(credential),
    body: JSON.stringify(payload)
  });
}

async function getOrders(credential) {
  return clob(`/orders?owner=${encodeURIComponent(credential.walletAddress)}`, {
    headers: authHeaders(credential)
  });
}

async function getTrades(credential) {
  return clob(`/trades?maker_address=${encodeURIComponent(credential.walletAddress)}`, {
    headers: authHeaders(credential)
  });
}

module.exports = { getBook, placeOrder, getOrders, getTrades };
