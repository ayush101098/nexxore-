const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');
const config = require('./config');

class MarketData extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.books = {};
    this.trades = {};
    this.tickers = {};
    this.connected = false;
    this.hyperliquidSubscriptionId = 0;
    this.assetIndices = {};
  }

  async loadHyperliquidAssets() {
    try {
      const response = await axios.post(`${config.hyperliquidApi}/info`, {
        type: 'meta'
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      const data = response.data;
      if (data && data.universe) {
        data.universe.forEach((item, idx) => {
          this.assetIndices[item.name] = idx;
        });
      }
    } catch (e) {
      console.error('Failed to load HyperLiquid assets', e);
    }
  }

  startHyperliquid() {
    this.ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

    this.ws.on('open', async () => {
      this.connected = true;
      this.emit('status', { connected: true });
      await this.loadHyperliquidAssets();

      // Subscribe to all books for top 20 markets
      config.symbols.forEach(symbol => {
        this.ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: {
            type: 'l2Book',
            coin: symbol
          }
        }));
        this.ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: {
            type: 'trades',
            coin: symbol
          }
        }));
      });

      // Poll for ticker data every 2s
      this.tickerInterval = setInterval(() => this.fetchHyperliquidTickers(), 2000);
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        // Handle orderbook updates
        if (msg.channel === 'l2Book' && msg.data) {
          const coin = msg.data.coin;
          const levels = msg.data.levels;
          
          // Safely parse bids and asks
          let bids = [];
          let asks = [];
          
          try {
            if (levels && Array.isArray(levels[0])) {
              bids = levels[0].map(level => {
                if (Array.isArray(level) && level.length >= 2) {
                  return { price: parseFloat(level[0]), size: parseFloat(level[1]) };
                }
                return null;
              }).filter(Boolean);
            }
            
            if (levels && Array.isArray(levels[1])) {
              asks = levels[1].map(level => {
                if (Array.isArray(level) && level.length >= 2) {
                  return { price: parseFloat(level[0]), size: parseFloat(level[1]) };
                }
                return null;
              }).filter(Boolean);
            }
          } catch (levelError) {
            console.warn('Error parsing orderbook levels:', levelError.message);
          }
          
          this.books[coin.toLowerCase()] = { bids, asks, lastUpdate: Date.now() };
          this.emit('orderbook', { symbol: coin.toLowerCase(), orderbook: this.books[coin.toLowerCase()] });
        }

        // Handle trade updates
        if (msg.channel === 'trades' && msg.data && Array.isArray(msg.data)) {
          msg.data.forEach(t => {
            if (t && t.coin) {
              const coin = t.coin;
              const trade = {
                price: parseFloat(t.px || 0),
                size: parseFloat(t.sz || 0),
                side: t.side,
                time: t.time
              };
              if (!this.trades[coin.toLowerCase()]) this.trades[coin.toLowerCase()] = [];
              this.trades[coin.toLowerCase()].unshift(trade);
              this.trades[coin.toLowerCase()] = this.trades[coin.toLowerCase()].slice(0, 80);
              this.emit('trade', { symbol: coin.toLowerCase(), trade });
            }
          });
        }
      } catch (err) {
        this.emit('error', err);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.emit('status', { connected: false });
      if (this.tickerInterval) clearInterval(this.tickerInterval);
      setTimeout(() => this.startHyperliquid(), 3000);
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  async fetchHyperliquidTickers() {
    try {
      const response = await axios.post(`${config.hyperliquidApi}/info`, {
        type: 'allMids'
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      const data = response.data;
      Object.entries(data).forEach(([symbol, price]) => {
        if (config.symbols.includes(symbol)) {
          const prevPrice = this.tickers[symbol.toLowerCase()]?.price || price;
          const change = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
          this.tickers[symbol.toLowerCase()] = {
            price: parseFloat(price),
            change,
            high: this.tickers[symbol.toLowerCase()]?.high || price,
            low: this.tickers[symbol.toLowerCase()]?.low || price
          };
          this.emit('ticker', { symbol: symbol.toLowerCase(), ticker: this.tickers[symbol.toLowerCase()] });
        }
      });
    } catch (err) {
      console.error('HyperLiquid ticker fetch failed', err);
    }
  }

  start() {
    if (config.useHyperliquid) {
      return this.startHyperliquid();
    }

    const streams = config.symbols.flatMap(symbol => [
      `${symbol}@ticker`,
      `${symbol}@depth20@100ms`,
      `${symbol}@trade`
    ]).join('/');

    this.ws = new WebSocket(`${config.wsUpstream}?streams=${streams}`);

    this.ws.on('open', () => {
      this.connected = true;
      this.emit('status', { connected: true });
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg?.data) return;
        const data = msg.data;
        const symbol = data?.s?.toLowerCase();
        if (!symbol) return;

        if (data.e === '24hrTicker') {
          this.tickers[symbol] = {
            price: parseFloat(data.c),
            change: parseFloat(data.P),
            high: parseFloat(data.h),
            low: parseFloat(data.l)
          };
          this.emit('ticker', { symbol, ticker: this.tickers[symbol] });
        }

        if (data.e === 'depthUpdate') {
          const bids = (data.b || []).map(([price, size]) => ({ price: parseFloat(price), size: parseFloat(size) }));
          const asks = (data.a || []).map(([price, size]) => ({ price: parseFloat(price), size: parseFloat(size) }));
          this.books[symbol] = { bids, asks, lastUpdate: Date.now() };
          this.emit('orderbook', { symbol, orderbook: this.books[symbol] });
        }

        if (data.e === 'trade') {
          const trade = {
            price: parseFloat(data.p),
            size: parseFloat(data.q),
            side: data.m ? 'sell' : 'buy',
            time: data.T
          };
          if (!this.trades[symbol]) this.trades[symbol] = [];
          this.trades[symbol].unshift(trade);
          this.trades[symbol] = this.trades[symbol].slice(0, 80);
          this.emit('trade', { symbol, trade });
        }
      } catch (err) {
        this.emit('error', err);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.emit('status', { connected: false });
      setTimeout(() => this.start(), 3000);
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  getTicker(symbol) {
    return this.tickers[symbol?.toLowerCase()] || null;
  }

  getOrderbook(symbol) {
    return this.books[symbol?.toLowerCase()] || null;
  }

  getTrades(symbol) {
    return this.trades[symbol?.toLowerCase()] || [];
  }

  snapshot() {
    const snap = {};
    for (const symbol of config.symbols) {
      snap[symbol] = {
        ticker: this.getTicker(symbol),
        orderbook: this.getOrderbook(symbol),
        trades: this.getTrades(symbol)
      };
    }
    return snap;
  }
}

module.exports = { MarketData };
