import { DanmakuEngine } from "./danmaku-engine.js";
import { DanmakuWsClient } from "./ws-client.js";

// --- Detect environment ---
const isTauri = "__TAURI__" in window;
const isPWA =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone;

// --- Canvas setup ---
const canvas = document.getElementById("danmaku-canvas");
const danmakuArea = document.getElementById("danmaku-area");

function resizeCanvas() {
  canvas.width = danmakuArea.clientWidth;
  canvas.height = danmakuArea.clientHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// --- Danmaku engine ---
const engine = new DanmakuEngine(canvas);
engine.start();

// --- WebSocket connection ---
function getWsUrl() {
  if (isTauri) {
    return "ws://localhost:1422/ws";
  }
  // PWA mode: connect to the host that served this page
  const host = window.location.hostname;
  return `ws://${host}:1422/ws`;
}

const statusEl = document.getElementById("connection-status");

const wsClient = new DanmakuWsClient(getWsUrl(), {
  onDanmaku: (msg) => {
    engine.addDanmaku(msg);
  },
  onControl: (action) => {
    switch (action.action) {
      case "set_speed":
        engine.setSpeed(action.value);
        speedSlider.value = action.value;
        speedValue.textContent = action.value;
        break;
      case "set_color":
        engine.setColor(action.value);
        colorPicker.value = action.value;
        break;
      case "toggle":
        engine.setEnabled(action.enabled);
        updateToggleBtn(action.enabled);
        break;
    }
  },
  onOpen: () => {
    statusEl.className = "status connected";
    statusEl.textContent = "Connected";
  },
  onClose: () => {
    statusEl.className = "status disconnected";
    statusEl.textContent = "Disconnected";
  },
  onError: () => {
    statusEl.className = "status disconnected";
    statusEl.textContent = "Error";
  },
});

wsClient.connect();

// --- Controls ---
const speedSlider = document.getElementById("speed-slider");
const speedValue = document.getElementById("speed-value");
const colorPicker = document.getElementById("color-picker");
const toggleBtn = document.getElementById("toggle-btn");

speedSlider.addEventListener("input", (e) => {
  const val = parseInt(e.target.value);
  speedValue.textContent = val;
  engine.setSpeed(val);
  wsClient.sendControl({ action: "set_speed", value: val });
});

colorPicker.addEventListener("input", (e) => {
  engine.setColor(e.target.value);
  wsClient.sendControl({ action: "set_color", value: e.target.value });
});

function updateToggleBtn(enabled) {
  toggleBtn.textContent = enabled ? "ON" : "OFF";
  toggleBtn.classList.toggle("active", enabled);
}

toggleBtn.addEventListener("click", () => {
  const newState = !engine.enabled;
  engine.setEnabled(newState);
  updateToggleBtn(newState);
  wsClient.sendControl({ action: "toggle", enabled: newState });
});

// --- QR Code modal ---
const qrBtn = document.getElementById("qr-btn");
const qrModal = document.getElementById("qr-modal");
const qrClose = document.getElementById("qr-close");
const qrSvg = document.getElementById("qr-svg");
const qrUrl = document.getElementById("qr-url");

qrBtn.addEventListener("click", async () => {
  if (isTauri) {
    try {
      const { invoke } = await import("@anthropic-ai/sdk");
      const svg = await window.__TAURI__.core.invoke("get_local_qr", {
        port: 1420,
      });
      const ip = await window.__TAURI__.core.invoke("get_local_ip");
      qrSvg.innerHTML = svg;
      qrUrl.textContent = `http://${ip}:1420`;
    } catch (e) {
      qrSvg.innerHTML = "<p>QR generation failed</p>";
      qrUrl.textContent = "";
    }
  } else {
    qrSvg.innerHTML = "<p>QR is only available on the desktop app</p>";
    qrUrl.textContent = window.location.origin;
  }
  qrModal.classList.add("show");
});

qrClose.addEventListener("click", () => {
  qrModal.classList.remove("show");
});

qrModal.addEventListener("click", (e) => {
  if (e.target === qrModal) {
    qrModal.classList.remove("show");
  }
});

// --- Demo mode (add test danmaku periodically for development) ---
if (import.meta.env.DEV) {
  const demoMessages = [
    "wwwwwwww",
    "草",
    "すごい！",
    "ニコニコ",
    "888888",
    "ktkr",
    "弾幕テスト",
    "NicoTauriX最高！",
  ];
  let demoIndex = 0;

  setInterval(() => {
    const text = demoMessages[demoIndex % demoMessages.length];
    const colors = [
      "#FFFFFF",
      "#FF0000",
      "#00FF00",
      "#FFFF00",
      "#FF69B4",
      "#00BFFF",
    ];
    engine.addDanmaku({
      text,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: Math.floor(Math.random() * 3) + 2,
    });
    demoIndex++;
  }, 800);
}
