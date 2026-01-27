# Getting Started with Nexxore

## Quick Start Guide

Get up and running with Nexxore in 5 minutes.

---

## Step 1: Connect Your Wallet

1. Navigate to [nexxore.vercel.app](https://nexxore.vercel.app)
2. Click **Connect Wallet** in the top right
3. Select your wallet provider:
   - MetaMask
   - WalletConnect
   - Coinbase Wallet
   - Rainbow
4. Approve the connection request

```
Supported Networks:
• Ethereum Mainnet
• Arbitrum
• Base
• Optimism
```

---

## Step 2: Choose Your Path

### 🔬 Research First (Recommended)
Start with the Research Agent to understand the market:
1. Go to **Research Agent**
2. Review market conditions
3. Check Fear & Greed index
4. Scan whale movements

### 💰 Start Earning Yield
Deploy into a strategy:
1. Go to **Strategy Builder**
2. Choose a risk template (start with Safe Yield)
3. Deposit collateral
4. Deploy strategy

### 📈 Trade Perpetuals
For experienced traders:
1. Go to **Perpetuals**
2. Select market (ETH, BTC, SOL)
3. Choose leverage carefully
4. Execute trades

### ⚖️ Go Delta Neutral
Earn yield without directional risk:
1. Go to **Delta Neutral**
2. Select asset
3. Configure position
4. Deploy

---

## Step 3: Deposit Funds

### For Strategy Builder / Delta Neutral

1. Ensure you have supported collateral:
   - ETH, WBTC, USDC, USDT, DAI, stETH, rETH

2. Approve the token:
   ```
   [Approve USDC] → Confirm in wallet
   ```

3. Deposit collateral:
   ```
   [Deposit] → Enter amount → Confirm
   ```

4. Mint nUSD (if using nUSD strategies):
   ```
   Collateral deposited → nUSD minted automatically
   ```

### For Perpetual Trading

1. Transfer USDC to trading wallet
2. Deposit as margin:
   ```
   [Deposit Margin] → Enter amount → Confirm
   ```

---

## Step 4: Monitor Your Positions

### Dashboard Overview
- **Total Value:** Combined position value
- **P&L:** Profit and loss since inception
- **Active Strategies:** Number of deployed strategies
- **Risk Level:** Current portfolio risk

### Position Cards
Each position shows:
- Strategy name
- Current value
- P&L ($ and %)
- Time active
- Next rebalance

### Alerts
Set up notifications:
1. Go to Settings
2. Configure Telegram/Discord
3. Enable alerts for:
   - P&L thresholds
   - Rebalancing events
   - Risk warnings

---

## Key Actions

### Add to Position
Increase allocation to existing strategy:
1. Click position card
2. Click **Add Funds**
3. Enter amount
4. Confirm transaction

### Withdraw
Exit partially or fully:
1. Click position card
2. Click **Withdraw**
3. Choose amount
4. Confirm transaction

### Change Strategy
Modify strategy parameters:
1. Click position card
2. Click **Modify**
3. Adjust parameters
4. Changes apply at next rebalance

---

## Safety Tips

### ✅ Do
- Start with small amounts
- Use Safe Yield template first
- Understand the strategy before deploying
- Monitor regularly
- Keep some funds in reserve

### ❌ Don't
- Deposit more than you can afford to lose
- Use maximum leverage without experience
- Ignore risk warnings
- Chase highest APY blindly
- Leave positions unmonitored

---

## Fees Overview

| Action | Fee |
|--------|-----|
| Minting nUSD | 0% |
| Stability Fee | 0.5-3.5% annually |
| Redemption | 0.5% |
| Strategy Management | 10% of profits |
| Perpetual Trading | 0.05% taker / 0.02% maker |

---

## Getting Help

### Resources
- [Documentation](./README.md)
- [FAQ](#faq)
- Discord Community
- Twitter Support

### Common Issues

**Transaction failing?**
- Check gas limit
- Ensure sufficient ETH for gas
- Try increasing slippage

**Wallet not connecting?**
- Clear browser cache
- Try different browser
- Check wallet is unlocked

**Position not showing?**
- Wait for transaction confirmation
- Refresh page
- Check correct network

---

## FAQ

**Q: What's the minimum deposit?**
A: No minimum, but $1,000+ recommended for gas efficiency.

**Q: Can I lose money?**
A: Yes. All strategies carry risk. Even "Safe Yield" can have drawdowns.

**Q: How is nUSD different from USDC?**
A: nUSD is backed by productive collateral earning yield. USDC backing sits idle.

**Q: What happens if ETH crashes?**
A: Positions with ETH collateral face liquidation risk. Monitor collateral ratios.

**Q: How do I close everything?**
A: Withdraw from each position, burn nUSD to reclaim collateral.

---

## Next Steps

Once comfortable with basics:

1. **Explore Research Agent** — Get market intelligence
2. **Try Alpha Agent** — Get trading signals
3. **Experiment with strategies** — Find your risk level
4. **Try Delta Neutral** — Earn without directional risk
5. **Join the community** — Learn from other users

---

## Ready to Start?

[Launch App →](https://nexxore.vercel.app)
