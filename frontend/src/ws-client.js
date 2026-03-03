/**
 * WebSocket client for danmaku synchronization
 */
export class DanmakuWsClient {
  /**
   * @param {string} url - WebSocket URL (ws://host:port/ws)
   * @param {object} callbacks
   * @param {function} [callbacks.onDanmaku] - Called with DanmakuMessage on new danmaku
   * @param {function} [callbacks.onControl] - Called with ControlAction on control message
   * @param {function} [callbacks.onOpen] - Called when connection opens
   * @param {function} [callbacks.onClose] - Called when connection closes
   * @param {function} [callbacks.onError] - Called on error
   */
  constructor(url, callbacks = {}) {
    this.url = url;
    this.callbacks = callbacks;
    this.ws = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 10;
    this._pingInterval = null;
    this._connected = false;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.callbacks.onError?.(e);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this._reconnectAttempts = 0;
      this.callbacks.onOpen?.();
      this._startPing();
    };

    this.ws.onmessage = (event) => {
      this._handleMessage(event.data);
    };

    this.ws.onclose = () => {
      this._connected = false;
      this._stopPing();
      this.callbacks.onClose?.();
      this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      this.callbacks.onError?.(err);
    };
  }

  /**
   * Parse and dispatch incoming message
   * @param {string} data
   */
  _handleMessage(data) {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case "danmaku":
          this.callbacks.onDanmaku?.(msg);
          break;
        case "control":
          this.callbacks.onControl?.(msg.action);
          break;
        case "pong":
          // Heartbeat received
          break;
        default:
          console.warn("Unknown message type:", msg.type);
      }
    } catch (e) {
      console.error("Failed to parse WS message:", e);
    }
  }

  /**
   * Send a danmaku message
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.color]
   * @param {number} [options.speed]
   * @param {number} [options.font_size]
   */
  sendDanmaku(text, options = {}) {
    this._send({
      type: "danmaku",
      text,
      color: options.color ?? "#FFFFFF",
      speed: options.speed ?? 3,
      font_size: options.font_size ?? 28,
    });
  }

  /**
   * Send a control command
   * @param {object} action
   */
  sendControl(action) {
    this._send({
      type: "control",
      action,
    });
  }

  /**
   * Send raw message
   * @param {object} msg
   */
  _send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Start ping interval
   */
  _startPing() {
    this._stopPing();
    this._pingInterval = setInterval(() => {
      this._send({ type: "ping" });
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  _stopPing() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Disconnect and clean up
   */
  disconnect() {
    this._stopPing();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempts = this._maxReconnectAttempts; // Prevent reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  /**
   * Check if currently connected
   * @returns {boolean}
   */
  get isConnected() {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }
}
