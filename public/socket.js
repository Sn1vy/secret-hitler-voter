export function createSocket() {
  const handlers = new Map();
  let ws = null;
  let reconnectDelay = 1000;
  let everConnected = false;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      const eventType = everConnected ? 'socket:reconnect' : 'socket:open';
      everConnected = true;
      reconnectDelay = 1000;
      dispatch(eventType, {});
    };

    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        dispatch(msg.type, msg);
      } catch {
        console.error('Bad message from server:', event.data);
      }
    };

    ws.onclose = () => {
      dispatch('socket:close', {});
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };

    ws.onerror = () => {
      // onclose fires after onerror; no extra handling needed
    };
  }

  function send(type, payload = {}) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  function on(type, handler) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(handler);
    return () => handlers.get(type).delete(handler);
  }

  function dispatch(type, data) {
    handlers.get(type)?.forEach(h => h(data));
  }

  connect();
  return { send, on };
}
