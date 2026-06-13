const crypto = require('crypto');

const mem = {
  deribit: new Map(),
  polymarket: new Map()
};

let supabase = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) supabase = createClient(supabaseUrl, supabaseKey);
} catch (_) {}

function mustGetKey() {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new Error('CREDENTIAL_ENCRYPTION_KEY missing');
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes');
  return buf;
}

function encryptJson(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', mustGetKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

function decryptJson(payload) {
  const [ivB64, tagB64, dataB64] = String(payload || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', mustGetKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

async function saveDeribitCredential(walletAddress, record) {
  const id = makeId('deri');
  const row = {
    id,
    wallet_address: String(walletAddress).toLowerCase(),
    encrypted_payload: encryptJson(record),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (supabase) {
    await supabase.from('deribit_credentials').upsert(row, { onConflict: 'id' });
  }
  mem.deribit.set(id, row);
  return id;
}

async function loadDeribitCredential(id, walletAddress) {
  const lowerWallet = String(walletAddress || '').toLowerCase();
  if (supabase) {
    const { data } = await supabase
      .from('deribit_credentials')
      .select('*')
      .eq('id', id)
      .eq('wallet_address', lowerWallet)
      .maybeSingle();
    if (data?.encrypted_payload) return decryptJson(data.encrypted_payload);
  }
  const row = mem.deribit.get(id);
  if (!row || row.wallet_address !== lowerWallet) return null;
  return decryptJson(row.encrypted_payload);
}

async function savePolymarketCredential(walletAddress, record) {
  const id = makeId('poly');
  const row = {
    id,
    wallet_address: String(walletAddress).toLowerCase(),
    encrypted_payload: encryptJson(record),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (supabase) {
    await supabase.from('polymarket_credentials').upsert(row, { onConflict: 'id' });
  }
  mem.polymarket.set(id, row);
  return id;
}

async function loadPolymarketCredential(id, walletAddress) {
  const lowerWallet = String(walletAddress || '').toLowerCase();
  if (supabase) {
    const { data } = await supabase
      .from('polymarket_credentials')
      .select('*')
      .eq('id', id)
      .eq('wallet_address', lowerWallet)
      .maybeSingle();
    if (data?.encrypted_payload) return decryptJson(data.encrypted_payload);
  }
  const row = mem.polymarket.get(id);
  if (!row || row.wallet_address !== lowerWallet) return null;
  return decryptJson(row.encrypted_payload);
}

module.exports = {
  saveDeribitCredential,
  loadDeribitCredential,
  savePolymarketCredential,
  loadPolymarketCredential
};
