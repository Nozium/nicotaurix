import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DanmakuWsClient } from "./ws-client.js";

/**
 * Mock WebSocket class for testing
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._sent = [];

    // Auto-connect after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this._sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helper: simulate receiving a message
  _receive(data) {
    this.onmessage?.({ data });
  }
}

describe("DanmakuWsClient", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should store url and callbacks", () => {
      const onDanmaku = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", {
        onDanmaku,
      });
      expect(client.url).toBe("ws://localhost:1422/ws");
      expect(client.callbacks.onDanmaku).toBe(onDanmaku);
      client.disconnect();
    });

    it("should start disconnected", () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      expect(client.isConnected).toBe(false);
      client.disconnect();
    });
  });

  describe("connect", () => {
    it("should create WebSocket and call onOpen", async () => {
      const onOpen = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", { onOpen });

      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      expect(onOpen).toHaveBeenCalled();
      expect(client.isConnected).toBe(true);
      client.disconnect();
    });

    it("should not create duplicate connections", async () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      const ws1 = client.ws;
      client.connect(); // Should be no-op
      expect(client.ws).toBe(ws1);
      client.disconnect();
    });
  });

  describe("message handling", () => {
    it("should dispatch danmaku messages to onDanmaku callback", async () => {
      const onDanmaku = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", {
        onDanmaku,
      });
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      const msg = {
        type: "danmaku",
        text: "Hello",
        color: "#FFFFFF",
        speed: 3,
        font_size: 28,
      };
      client.ws._receive(JSON.stringify(msg));

      expect(onDanmaku).toHaveBeenCalledWith(msg);
      client.disconnect();
    });

    it("should dispatch control messages to onControl callback", async () => {
      const onControl = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", {
        onControl,
      });
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      const msg = {
        type: "control",
        action: { action: "set_speed", value: 5 },
      };
      client.ws._receive(JSON.stringify(msg));

      expect(onControl).toHaveBeenCalledWith({ action: "set_speed", value: 5 });
      client.disconnect();
    });

    it("should handle pong silently", async () => {
      const onDanmaku = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", {
        onDanmaku,
      });
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      client.ws._receive(JSON.stringify({ type: "pong" }));
      expect(onDanmaku).not.toHaveBeenCalled();
      client.disconnect();
    });

    it("should handle malformed JSON gracefully", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      expect(() => client.ws._receive("not json")).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
      client.disconnect();
    });
  });

  describe("sendDanmaku", () => {
    it("should send properly formatted danmaku message", async () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      client.sendDanmaku("テスト", { color: "#FF0000", speed: 4 });

      const sent = JSON.parse(client.ws._sent[0]);
      expect(sent.type).toBe("danmaku");
      expect(sent.text).toBe("テスト");
      expect(sent.color).toBe("#FF0000");
      expect(sent.speed).toBe(4);
      client.disconnect();
    });

    it("should use defaults when options not specified", async () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      client.sendDanmaku("Default");

      const sent = JSON.parse(client.ws._sent[0]);
      expect(sent.color).toBe("#FFFFFF");
      expect(sent.speed).toBe(3);
      expect(sent.font_size).toBe(28);
      client.disconnect();
    });

    it("should not send when disconnected", () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      // Don't connect
      client.sendDanmaku("NoSend");
      // Should not throw
    });
  });

  describe("sendControl", () => {
    it("should send control action", async () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      client.sendControl({ action: "toggle", enabled: false });

      const sent = JSON.parse(client.ws._sent[0]);
      expect(sent.type).toBe("control");
      expect(sent.action).toEqual({ action: "toggle", enabled: false });
      client.disconnect();
    });
  });

  describe("disconnect", () => {
    it("should close WebSocket and set connected to false", async () => {
      const onClose = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", {
        onClose,
      });
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      client.disconnect();
      expect(client.isConnected).toBe(false);
      expect(client.ws).toBeNull();
    });

    it("should prevent reconnection after disconnect", async () => {
      const client = new DanmakuWsClient("ws://localhost:1422/ws");
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      client.disconnect();

      // Advance past any reconnect timers
      await vi.advanceTimersByTimeAsync(60000);
      expect(client.ws).toBeNull();
    });
  });

  describe("reconnection", () => {
    it("should attempt reconnection on close with exponential backoff", async () => {
      const onOpen = vi.fn();
      const client = new DanmakuWsClient("ws://localhost:1422/ws", { onOpen });
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      // Simulate unexpected close
      client.ws.readyState = MockWebSocket.CLOSED;
      client.ws.onclose?.();

      // After 1 second, should attempt reconnect
      await vi.advanceTimersByTimeAsync(1100);
      expect(onOpen).toHaveBeenCalledTimes(2);
      client.disconnect();
    });
  });
});
