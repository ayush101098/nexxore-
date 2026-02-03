const express = require('express');
const cors = require('cors');
const http = require('http');
const EventEmitter = require('events');
const config = require('./config');
const { ensureSchema } = require('./schema');
const { MarketData } = require('./marketData');
const { computeExecutionPlan } = require('./router');
const { validateOrder } = require('./riskEngine');
const { buildAdapters } = require('./adapters');
const { writeOrderbookUpdate } = require('./orderbookService');
const {
  createTrade,
  createPosition,
  createOrder,
  updateOrderStatus,
  getOpenOrders,
  getOrdersByWallet,
  updateMarkPrices,
  closePosition,
  getOpenPositions,
  getPositionsByWallet,
  getTradeHistory,
  getOpenPositionForMarket,
  reducePosition
} = require('./positionService');
const { checkLiquidations, createAlert } = require('./liquidationMonitor');
const { startWsServer } = require('./wsServer');

const app = express();
const server = http.createServer(app);
const positionEmitter = new EventEmitter();
const adapters = buildAdapters(config);

const getAdapter = (chain) => {
  if (chain === 'solana') return adapters.solana;
  return adapters.evm;
};

app.use(cors());
app.use(express.json());

const marketData = new MarketData();

app.get('/api/perps/health', (req, res) => {
  res.json({ status: 'ok', wsConnected: marketData.connected, time: new Date().toISOString() });
});

app.get('/api/perps/markets', (req, res) => {
  const snapshot = marketData.snapshot();
  res.json({ markets: snapshot });
});

app.get('/api/perps/positions', async (req, res) => {
  try {
    const { address } = req.query;
    const positions = address ? await getPositionsByWallet(address) : [];
    res.json({ positions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/perps/history', async (req, res) => {
  try {
    const { address } = req.query;
    const trades = address ? await getTradeHistory(address) : [];
    res.json({ trades });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/perps/orders', async (req, res) => {
  try {
    const { address } = req.query;
    const orders = address ? await getOrdersByWallet(address) : [];
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/perps/alerts', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.json({ alerts: [] });
    const { query } = require('./db');
    const result = await query('SELECT * FROM perps_alerts WHERE wallet_address = $1 ORDER BY created_at DESC', [address]);
    res.json({ alerts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/order', async (req, res) => {
  try {
    const body = req.body;
    const { walletAddress, market, side, amount, leverage, orderType, executionModel, chain, reduceOnly, postOnly, tpPrice, slPrice } = body;

    const validation = validateOrder({ amount, leverage });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.reason });
    }

    const symbol = market?.toLowerCase();
    const ticker = marketData.getTicker(symbol);
    const price = body.price || ticker?.price;

    if (!price) {
      return res.status(400).json({ error: 'Price feed unavailable' });
    }

    // Check if using HyperLiquid execution
    const useHyperliquid = config.useHyperliquid && body.hyperliquidAction;
    const plan = useHyperliquid 
      ? { route: 'hyperliquid', feeRate: config.takerFee }
      : computeExecutionPlan({ notional: amount * leverage, price, model: executionModel || 'hybrid' });

    const orderKind = orderType || 'market';

    const openPosition = reduceOnly
      ? await getOpenPositionForMarket({ walletAddress, market: symbol })
      : null;

    if (reduceOnly && (!openPosition || openPosition.status !== 'open')) {
      return res.status(400).json({ error: 'Reduce-only requires an open position' });
    }

    if (reduceOnly && openPosition && openPosition.side === side) {
      return res.status(400).json({ error: 'Reduce-only order must be opposite side of position' });
    }

    if (orderKind === 'limit') {
      const remainingSize = (amount * leverage) / price;
      const order = await createOrder({
        walletAddress,
        chain: chain || 'multi',
        market: symbol,
        side,
        orderType: orderKind,
        price,
        amount,
        leverage,
        remainingSize,
        reduceOnly,
        postOnly,
        tpPrice,
        slPrice
      });

      await writeOrderbookUpdate({
        market: symbol,
        side,
        price,
        size: remainingSize,
        orderId: order.id,
        status: 'open'
      });

      return res.json({ order, execution: plan });
    }

    const orderId = Date.now();
    const notional = amount * leverage;
    const feeRole = 'taker';
    const feeAmount = notional * (plan.feeRate || config.takerFee);
    const trade = {
      id: orderId,
      wallet_address: walletAddress,
      chain: chain || 'multi',
      market: symbol,
      side,
      order_type: orderKind,
      price,
      amount,
      leverage,
      execution_model: executionModel || 'hybrid',
      execution_status: useHyperliquid ? 'hyperliquid' : 'filled',
      execution_mode: useHyperliquid ? 'hyperliquid' : 'router',
      status: 'filled',
      route: plan.route,
      fee_rate: plan.feeRate,
      fee_amount: feeAmount,
      fee_role: feeRole
    };

    await createTrade(trade);
    
    // Execute via HyperLiquid if action provided
    if (useHyperliquid) {
      try {
        const hlResponse = await fetch(`${config.hyperliquidApi}/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: body.hyperliquidAction,
            nonce: body.hyperliquidNonce,
            signature: body.hyperliquidSignature,
            vaultAddress: body.vaultAddress || null
          })
        });
        const hlData = await hlResponse.json();
        trade.hyperliquid_response = hlData;
      } catch (hlErr) {
        console.error('HyperLiquid execution failed', hlErr);
      }
    }
    
    if (reduceOnly && openPosition) {
      const reduceSize = Math.min(openPosition.size, (amount * leverage) / price);
      const reduced = await reducePosition({
        positionId: openPosition.id,
        reduceSize,
        closePrice: price,
        reason: 'reduce_only'
      });
      positionEmitter.emit('position', { type: 'close', position: reduced });
        const clientSigned = Boolean(body.clientSigned);
        if (!clientSigned && !useHyperliquid) {
          const adapter = getAdapter(reduced.chain);
          await adapter.settleClose({
            wallet: reduced.wallet_address,
            market: reduced.market,
            size: reduceSize,
            price
          });
        }
      return res.json({ order: trade, position: reduced, execution: plan });
    }

    const position = await createPosition({
      walletAddress,
      chain: trade.chain,
      market: symbol,
      side,
      price,
      amount,
      leverage,
      tpPrice,
      slPrice
    });

    positionEmitter.emit('position', { type: 'open', position });
    const adapter = getAdapter(position.chain);
      if (!clientSigned && !useHyperliquid) {
        await adapter.settleTrade({
          wallet: position.wallet_address,
          market: position.market,
          size: position.size,
          price,
          side: position.side,
          leverage: position.leverage,
          margin: position.margin
        });
      }

    res.json({ order: trade, position, execution: plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/cancel', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });
    const order = await updateOrderStatus({ orderId, status: 'cancelled' });
    if (order) {
      await writeOrderbookUpdate({
        market: order.market,
        side: order.side,
        price: Number(order.price),
        size: 0,
        orderId: order.id,
        status: 'cancelled'
      });
    }
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/solana/deposit', async (req, res) => {
  try {
    const { amount, userTokenAccount } = req.body;
    if (!amount || !userTokenAccount) {
      return res.status(400).json({ error: 'amount and userTokenAccount required' });
    }
    const result = await adapters.solana.depositMargin({ amount, userTokenAccount });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/solana/prepare-open', async (req, res) => {
  try {
    const { walletAddress, market, size, price, margin, leverage, side } = req.body;
    if (!walletAddress || !market || !size || !price || !margin) {
      return res.status(400).json({ error: 'walletAddress, market, size, price, margin required' });
    }
    const result = await adapters.solana.buildOpenPositionTx({
      walletAddress,
      market,
      size,
      price,
      margin,
      leverage,
      side
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/solana/prepare-close', async (req, res) => {
  try {
    const { walletAddress, market, price } = req.body;
    if (!walletAddress || !market || !price) {
      return res.status(400).json({ error: 'walletAddress, market, price required' });
    }
    const result = await adapters.solana.buildClosePositionTx({ walletAddress, market, price });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/solana/prepare-deposit', async (req, res) => {
  try {
    const { walletAddress, amount, userTokenAccount } = req.body;
    if (!walletAddress || !amount || !userTokenAccount) {
      return res.status(400).json({ error: 'walletAddress, amount, userTokenAccount required' });
    }
    const result = await adapters.solana.buildDepositTx({ walletAddress, amount, userTokenAccount });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/solana/prepare-withdraw', async (req, res) => {
  try {
    const { walletAddress, amount, userTokenAccount } = req.body;
    if (!walletAddress || !amount || !userTokenAccount) {
      return res.status(400).json({ error: 'walletAddress, amount, userTokenAccount required' });
    }
    const result = await adapters.solana.buildWithdrawTx({ walletAddress, amount, userTokenAccount });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/solana/withdraw', async (req, res) => {
  try {
    const { amount, userTokenAccount } = req.body;
    if (!amount || !userTokenAccount) {
      return res.status(400).json({ error: 'amount and userTokenAccount required' });
    }
    const result = await adapters.solana.withdrawMargin({ amount, userTokenAccount });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/perps/close', async (req, res) => {
  try {
    const { positionId, price, reason, size } = req.body;
    let position = null;

    if (size) {
      position = await reducePosition({ positionId, reduceSize: size, closePrice: price, reason: reason || 'partial_close' });
    } else {
      position = await closePosition({ positionId, closePrice: price, reason: reason || 'closed' });
    }
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    positionEmitter.emit('position', { type: 'close', position });

    const clientSigned = Boolean(req.body?.clientSigned);
    if (!clientSigned) {
      const adapter = getAdapter(position.chain);
      await adapter.settleClose({
        wallet: position.wallet_address,
        market: position.market,
        size: position.size,
        price,
        leverage: position.leverage,
        margin: position.margin
      });
    }

    res.json({ position });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const start = async () => {
  await ensureSchema();
  marketData.start();
  startWsServer({ server, marketData, positionEmitter });

  setInterval(async () => {
    const snapshot = marketData.snapshot();
    const markPrices = {};
    for (const symbol of Object.keys(snapshot)) {
      const price = snapshot[symbol]?.ticker?.price;
      if (price) markPrices[symbol] = price;
    }
    await updateMarkPrices(markPrices);

    const openPositions = await getOpenPositions();
    const liquidated = await checkLiquidations({ positions: openPositions, markPrices });
    liquidated.forEach(pos => positionEmitter.emit('position', { type: 'liquidation', position: pos }));
  }, 4000);

  setInterval(async () => {
    const snapshot = marketData.snapshot();
    const markPrices = {};
    for (const symbol of Object.keys(snapshot)) {
      const price = snapshot[symbol]?.ticker?.price;
      if (price) markPrices[symbol] = price;
    }

    const openOrders = await getOpenOrders();
    for (const order of openOrders) {
      const mark = markPrices[order.market];
      if (!mark || !order.price) continue;

      const shouldFill = order.side === 'long'
        ? mark <= Number(order.price)
        : mark >= Number(order.price);

      if (!shouldFill) continue;

      const notional = Number(order.amount) * Number(order.leverage);
      const feeRole = 'maker';
      const feeAmount = notional * config.makerFee;
      const trade = {
        id: Date.now(),
        wallet_address: order.wallet_address,
        chain: order.chain,
        market: order.market,
        side: order.side,
        order_type: 'limit',
        price: Number(order.price),
        amount: Number(order.amount),
        leverage: Number(order.leverage),
        execution_model: 'limit',
        execution_status: 'filled',
        execution_mode: 'router',
        status: 'filled',
        route: 'CLOB',
        fee_rate: config.makerFee,
        fee_amount: feeAmount,
        fee_role: feeRole
      };

      await createTrade(trade);
      await updateOrderStatus({ orderId: order.id, status: 'filled' });
      await writeOrderbookUpdate({
        market: order.market,
        side: order.side,
        price: Number(order.price),
        size: 0,
        orderId: order.id,
        status: 'filled'
      });

      if (order.reduce_only) {
        const openPosition = await getOpenPositionForMarket({ walletAddress: order.wallet_address, market: order.market });
        if (openPosition && openPosition.side !== order.side) {
          const reduceSize = Math.min(openPosition.size, (Number(order.amount) * Number(order.leverage)) / Number(order.price));
          const reduced = await reducePosition({
            positionId: openPosition.id,
            reduceSize,
            closePrice: Number(order.price),
            reason: 'reduce_only'
          });
          positionEmitter.emit('position', { type: 'close', position: reduced });
          const adapter = getAdapter(reduced.chain);
          await adapter.settleClose({
            wallet: reduced.wallet_address,
            market: reduced.market,
            size: reduceSize,
            price: Number(order.price),
            leverage: reduced.leverage,
            margin: reduced.margin
          });
          continue;
        }

        await updateOrderStatus({ orderId: order.id, status: 'cancelled' });
        await writeOrderbookUpdate({
          market: order.market,
          side: order.side,
          price: Number(order.price),
          size: 0,
          orderId: order.id,
          status: 'cancelled'
        });
        continue;
      }

      const position = await createPosition({
        walletAddress: order.wallet_address,
        chain: order.chain,
        market: order.market,
        side: order.side,
        price: Number(order.price),
        amount: Number(order.amount),
        leverage: Number(order.leverage),
        tpPrice: order.tp_price,
        slPrice: order.sl_price
      });

      positionEmitter.emit('position', { type: 'open', position });
      const adapter = getAdapter(position.chain);
      await adapter.settleTrade({
        wallet: position.wallet_address,
        market: position.market,
        size: position.size,
        price: Number(order.price),
        side: position.side,
        leverage: position.leverage,
        margin: position.margin
      });
    }
  }, 3000);

  setInterval(async () => {
    const snapshot = marketData.snapshot();
    const markPrices = {};
    for (const symbol of Object.keys(snapshot)) {
      const price = snapshot[symbol]?.ticker?.price;
      if (price) markPrices[symbol] = price;
    }

    const openPositions = await getOpenPositions();
    for (const position of openPositions) {
      const mark = markPrices[position.market];
      if (!mark) continue;

      if (position.tp_price) {
        const hitTP = position.side === 'long'
          ? mark >= Number(position.tp_price)
          : mark <= Number(position.tp_price);
        if (hitTP) {
          const closed = await closePosition({ positionId: position.id, closePrice: mark, reason: 'take_profit' });
          positionEmitter.emit('position', { type: 'close', position: closed });
          continue;
        }
      }

      if (position.sl_price) {
        const hitSL = position.side === 'long'
          ? mark <= Number(position.sl_price)
          : mark >= Number(position.sl_price);
        if (hitSL) {
          const closed = await closePosition({ positionId: position.id, closePrice: mark, reason: 'stop_loss' });
          positionEmitter.emit('position', { type: 'close', position: closed });
        }
      }
    }
  }, 3500);

  setInterval(async () => {
    const openPositions = await getOpenPositions();
    for (const position of openPositions) {
      if (position.margin > 0 && position.unrealized_pnl < 0) {
        const health = (position.margin + position.unrealized_pnl) / position.margin;
        if (health < 0.5) {
          await createAlert({
            walletAddress: position.wallet_address,
            market: position.market,
            alertType: 'risk',
            message: 'Margin health below 50%'
          });
        }
      }
    }
  }, 12000);

  server.listen(config.port, () => {
    console.log(`✅ Perps service running on ${config.port}`);
  });
};

start().catch((err) => {
  console.error('Perps service failed:', err);
  process.exit(1);
});
