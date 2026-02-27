// Telegram Bot API — Posts trade alerts to Telegram channel
// Uses env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { trades, message } = body || {};

    let text = '';

    // If raw message passed, send directly
    if (message) {
      text = message;
    }
    // If trades array passed, format them
    else if (trades && Array.isArray(trades) && trades.length > 0) {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      text = `🎯 *NEXXORE PRED Agent — Trade Alerts*\n📅 ${now}\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      trades.forEach((t, i) => {
        const edgeSign = t.edge > 0 ? '+' : '';
        const direction = t.edge > 0 ? '🟢 BUY YES' : '🔴 BUY NO';
        const confidence = t.confidence || '—';
        const volume = t.volume || '—';

        text += `*${i + 1}. ${escapeMarkdown(t.title)}*\n`;
        text += `   ${direction} · Edge: *${edgeSign}${t.edge}¢*\n`;
        text += `   📊 Market: YES ${t.yesOdds}¢ → Fair ${t.fairValue}¢\n`;
        text += `   🎯 Confidence: ${confidence}% · 💰 Vol: ${volume}\n`;
        text += `   📌 ${t.platform || 'Polymarket'} · ${t.category || ''}\n`;
        if (t.expiry) text += `   ⏰ Expires: ${t.expiry}\n`;
        text += `\n`;
      });

      text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🤖 _Automated by PRED Agent v6.0_\n`;
      text += `🌐 [View Dashboard](https://nexxore.xyz/predictions)`;
    } else {
      return res.status(400).json({ error: 'Provide trades array or message string.' });
    }

    // Send to Telegram
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error('Telegram API error:', tgData);
      return res.status(502).json({ error: 'Telegram API error', details: tgData.description });
    }

    return res.status(200).json({
      success: true,
      message_id: tgData.result.message_id,
      trades_sent: trades ? trades.length : 1,
    });

  } catch (err) {
    console.error('Telegram send error:', err);
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
};

function escapeMarkdown(text) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
