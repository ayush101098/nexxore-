/**
 * Nexxore Payment Verification Server
 * 
 * This server:
 * 1. Receives webhooks from Alchemy when ETH is sent to payment address
 * 2. Verifies the payment amount (~$19 in ETH)
 * 3. Stores user access in database
 * 4. Sends confirmation email to user
 * 
 * Setup:
 * 1. Create Alchemy account → Dashboard → Webhooks → Address Activity
 * 2. Set webhook URL to: https://your-domain.com/webhook/payment
 * 3. Monitor address: 0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// ===== CONFIGURATION =====
const CONFIG = {
  PAYMENT_ADDRESS: '0x905aCd442c7B3EF9BfEB0A3189f3686c1Cd0c697'.toLowerCase(),
  MIN_PAYMENT_USD: 18, // Allow slight variance
  MAX_PAYMENT_USD: 25,
  SUBSCRIPTION_DAYS: 30,
  ALCHEMY_SIGNING_KEY: process.env.ALCHEMY_SIGNING_KEY,
};

// ===== DATABASE (Supabase) =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ===== EMAIL =====
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ===== HELPER FUNCTIONS =====

// Get current ETH price from Binance
async function getEthPrice() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
    const data = await res.json();
    return parseFloat(data.price);
  } catch (err) {
    console.error('Failed to fetch ETH price:', err);
    return 3200; // Fallback price
  }
}

// Convert Wei to ETH
function weiToEth(wei) {
  return parseInt(wei, 16) / 1e18;
}

// Verify Alchemy webhook signature
function verifyAlchemySignature(req) {
  const signature = req.headers['x-alchemy-signature'];
  if (!CONFIG.ALCHEMY_SIGNING_KEY) return true; // Skip in dev
  
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', CONFIG.ALCHEMY_SIGNING_KEY);
  hmac.update(JSON.stringify(req.body));
  const expectedSignature = hmac.digest('hex');
  
  return signature === expectedSignature;
}

// ===== DATABASE OPERATIONS =====

// Check if wallet already has active subscription
async function checkExistingSubscription(walletAddress) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .gt('expires_at', new Date().toISOString())
    .single();
  
  return data;
}

// Create or extend subscription
async function createSubscription(walletAddress, txHash, amountEth, amountUsd) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + CONFIG.SUBSCRIPTION_DAYS);
  
  const { data, error } = await supabase
    .from('subscriptions')
    .upsert({
      wallet_address: walletAddress.toLowerCase(),
      tx_hash: txHash,
      amount_eth: amountEth,
      amount_usd: amountUsd,
      tier: 'agent_pro',
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'active',
    }, {
      onConflict: 'wallet_address',
    })
    .select();
  
  if (error) {
    console.error('Database error:', error);
    throw error;
  }
  
  return data[0];
}

// Log all transactions (for audit)
async function logTransaction(txData) {
  await supabase
    .from('payment_logs')
    .insert({
      tx_hash: txData.hash,
      from_address: txData.from,
      to_address: txData.to,
      value_wei: txData.value,
      value_eth: weiToEth(txData.value),
      block_number: txData.blockNumber,
      timestamp: new Date().toISOString(),
      status: txData.status || 'pending',
    });
}

// ===== EMAIL NOTIFICATIONS =====

async function sendConfirmationEmail(walletAddress, subscription) {
  // First check if we have their email in the waitlist
  const { data: user } = await supabase
    .from('waitlist')
    .select('email')
    .eq('wallet_address', walletAddress.toLowerCase())
    .single();
  
  if (!user?.email) {
    console.log('No email found for wallet:', walletAddress);
    return;
  }
  
  await transporter.sendMail({
    from: '"Nexxore" <noreply@nexxore.io>',
    to: user.email,
    subject: '✅ Agent Pro Access Activated',
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #a855f7; margin-bottom: 20px;">Welcome to Agent Pro!</h1>
        <p style="color: #666; line-height: 1.6;">
          Your payment has been verified and your Agent Pro subscription is now active.
        </p>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 24px 0;">
          <p style="margin: 0 0 8px; color: #666; font-size: 14px;">Subscription Details:</p>
          <p style="margin: 0; font-weight: 600;">Tier: Agent Pro</p>
          <p style="margin: 8px 0 0; font-weight: 600;">Expires: ${new Date(subscription.expires_at).toLocaleDateString()}</p>
          <p style="margin: 8px 0 0; font-size: 12px; color: #999;">Wallet: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}</p>
        </div>
        <p style="color: #666; line-height: 1.6;">
          You now have full access to all four agents. Log in with your wallet to get started.
        </p>
        <a href="https://nexxore.vercel.app/agents.html" style="display: inline-block; background: #a855f7; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">
          Access Your Agents →
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 32px;">
          Questions? Reply to this email or join our Discord.
        </p>
      </div>
    `,
  });
  
  console.log('Confirmation email sent to:', user.email);
}

// ===== API ROUTES =====

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Alchemy Webhook - receives notifications when ETH is sent to payment address
app.post('/webhook/payment', async (req, res) => {
  try {
    // Verify webhook signature
    if (!verifyAlchemySignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const { event } = req.body;
    
    // Only process ADDRESS_ACTIVITY events
    if (event?.eventType !== 'ADDRESS_ACTIVITY') {
      return res.json({ status: 'ignored', reason: 'not address activity' });
    }
    
    const activities = event.activity || [];
    
    for (const activity of activities) {
      // Only process incoming ETH transfers to our payment address
      if (activity.toAddress?.toLowerCase() !== CONFIG.PAYMENT_ADDRESS) {
        continue;
      }
      
      if (activity.category !== 'external' || activity.asset !== 'ETH') {
        continue;
      }
      
      const txHash = activity.hash;
      const fromAddress = activity.fromAddress;
      const valueEth = parseFloat(activity.value);
      
      console.log(`\n💰 Payment received!`);
      console.log(`   From: ${fromAddress}`);
      console.log(`   Amount: ${valueEth} ETH`);
      console.log(`   Tx: ${txHash}`);
      
      // Get current ETH price and validate payment amount
      const ethPrice = await getEthPrice();
      const valueUsd = valueEth * ethPrice;
      
      console.log(`   USD Value: $${valueUsd.toFixed(2)} (ETH @ $${ethPrice})`);
      
      // Log transaction regardless of amount
      await logTransaction({
        hash: txHash,
        from: fromAddress,
        to: CONFIG.PAYMENT_ADDRESS,
        value: activity.rawContract?.value || '0x0',
        blockNumber: activity.blockNum,
        status: valueUsd >= CONFIG.MIN_PAYMENT_USD ? 'valid' : 'insufficient',
      });
      
      // Validate payment amount
      if (valueUsd < CONFIG.MIN_PAYMENT_USD) {
        console.log(`   ⚠️ Payment too low: $${valueUsd.toFixed(2)} < $${CONFIG.MIN_PAYMENT_USD}`);
        continue;
      }
      
      if (valueUsd > CONFIG.MAX_PAYMENT_USD) {
        console.log(`   ⚠️ Payment too high: $${valueUsd.toFixed(2)} > $${CONFIG.MAX_PAYMENT_USD}`);
        // Still process but log warning
      }
      
      // Create subscription
      const subscription = await createSubscription(fromAddress, txHash, valueEth, valueUsd);
      console.log(`   ✅ Subscription created! Expires: ${subscription.expires_at}`);
      
      // Send confirmation email
      await sendConfirmationEmail(fromAddress, subscription);
    }
    
    res.json({ status: 'processed' });
    
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manual verification endpoint (for admin use)
app.post('/admin/verify-payment', async (req, res) => {
  const { adminKey, walletAddress, txHash } = req.body;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const subscription = await createSubscription(walletAddress, txHash, 0, 19);
    await sendConfirmationEmail(walletAddress, subscription);
    res.json({ success: true, subscription });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check subscription status (for frontend)
app.get('/api/subscription/:wallet', async (req, res) => {
  const wallet = req.params.wallet.toLowerCase();
  
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, expires_at, status')
    .eq('wallet_address', wallet)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (error || !data) {
    return res.json({ active: false });
  }
  
  res.json({
    active: true,
    tier: data.tier,
    expiresAt: data.expires_at,
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Nexxore Payment Server running on port ${PORT}`);
  console.log(`   Payment Address: ${CONFIG.PAYMENT_ADDRESS}`);
  console.log(`   Min Payment: $${CONFIG.MIN_PAYMENT_USD}`);
  console.log(`   Subscription: ${CONFIG.SUBSCRIPTION_DAYS} days\n`);
});
