const WebSocket = require('ws');

const startWsServer = ({ server, marketData, positionEmitter }) => {
  const wss = new WebSocket.Server({ server, path: '/ws/perps' });

  wss.on('connection', (socket) => {
    const state = { market: null };

    socket.send(JSON.stringify({
      type: 'snapshot',
      data: marketData.snapshot()
    }));

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe') {
          state.market = msg.market?.toLowerCase() || null;
        }
      } catch (err) {
        // ignore bad payloads
      }
    });

    const broadcastIfMatch = (payload) => {
      if (!state.market || state.market === payload.symbol) {
        socket.send(JSON.stringify(payload));
      }
    };

    const tickerHandler = (payload) => broadcastIfMatch({ type: 'ticker', ...payload });
    const orderbookHandler = (payload) => broadcastIfMatch({ type: 'orderbook', ...payload });
    const tradeHandler = (payload) => broadcastIfMatch({ type: 'trade', ...payload });

    marketData.on('ticker', tickerHandler);
    marketData.on('orderbook', orderbookHandler);
    marketData.on('trade', tradeHandler);

    const positionHandler = (payload) => {
      socket.send(JSON.stringify({ type: 'position', data: payload }));
    };

    positionEmitter.on('position', positionHandler);

    socket.on('close', () => {
      marketData.off('ticker', tickerHandler);
      marketData.off('orderbook', orderbookHandler);
      marketData.off('trade', tradeHandler);
      positionEmitter.off('position', positionHandler);
    });
  });

  return wss;
};

module.exports = { startWsServer };
