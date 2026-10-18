/**
 * Waitlist API — Auto-record submissions to Google Sheets
 * ════════════════════════════════════════════════════════
 * 
 * POST /api/waitlist  { email: "user@example.com", name?: "...", timestamp?: "..." }
 * 
 * Records submissions automatically to Google Sheet
 */

const { google } = require('googleapis');
const path = require('path');

// Google Sheets API configuration
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Waitlist'; // The sheet tab name

// Service-account auth. On Vercel, put the whole key JSON in
// GOOGLE_SERVICE_ACCOUNT_JSON (there is no key file on disk there).
// GOOGLE_APPLICATION_CREDENTIALS (a file path) still works for local runs.
async function getAuthClient() {
  try {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const auth = raw
      ? new google.auth.GoogleAuth({ credentials: JSON.parse(raw), scopes })
      : new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../credentials.json'), scopes });
    return await auth.getClient();
  } catch (error) {
    console.error('Auth error:', error.message);
    return null;
  }
}

async function appendToSheet(email, name = '', source = 'website') {
  try {
    const auth = await getAuthClient();
    if (!auth) {
      return { success: false, error: 'Authentication failed. Check credentials.' };
    }

    const sheets = google.sheets({ version: 'v4', auth });
    
    const timestamp = new Date().toISOString();
    const values = [[email, name, source, timestamp]];
    
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: 'RAW',
      resource: { values }
    });

    console.log(`✓ Appended to sheet: ${email}`);
    return { success: true, message: 'Successfully added to waitlist' };
  } catch (error) {
    console.error('Sheet append error:', error);
    return { success: false, error: 'Failed to save to waitlist' };
  }
}

// Main handler
async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const email = String(body.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }
  if (!SHEET_ID) {
    res.status(500).json({ success: false, error: 'Waitlist not configured' });
    return;
  }

  // Where the signup came from: homepage, gate:<page>, app:<page>, terminal-pro
  const source = String(body.source || 'website').replace(/[^a-z0-9:_-]/gi, '').slice(0, 40) || 'website';
  // Written with valueInputOption RAW, so no value is ever run as a formula
  const result = await appendToSheet(email, String(body.name || '').slice(0, 200), source);
  
  if (result.success) {
    res.status(200).json({ success: true, message: result.message });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
}

// For local testing with Node
if (require.main === module) {
  const { http } = require('http');
  const url = require('url');
  
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/waitlist' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          req.body = JSON.parse(body);
        } catch (e) {
          req.body = {};
        }
        await handler(req, res);
      });
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  
  server.listen(3001, () => {
    console.log('Waitlist API listening on port 3001');
  });
}

module.exports = handler;
