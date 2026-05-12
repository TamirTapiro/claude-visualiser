const handlers = [];
let ws = null;
let reconnectTimer = null;

export function onEvent(handler) {
  handlers.push(handler);
}

export function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onmessage = e => {
    try {
      const event = JSON.parse(e.data);
      for (const h of handlers) h(event);
    } catch {}
  };

  ws.onclose = () => {
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
    for (const h of handlers) h({ type: 'disconnected' });
  };

  ws.onerror = () => {};

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    for (const h of handlers) h({ type: 'connected' });
  };
}

export function disconnect() {
  if (ws) { ws.close(); ws = null; }
}
