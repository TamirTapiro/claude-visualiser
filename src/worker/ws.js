'use strict';

const { WebSocketServer, WebSocket } = require('ws');

let wss = null;

function attachWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', ws => {
    ws.on('error', () => {});
    ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
  });

  return wss;
}

function broadcast(event) {
  if (!wss) return;
  const msg = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

module.exports = { attachWebSocket, broadcast };
