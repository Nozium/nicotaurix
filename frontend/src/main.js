import { DanmakuWsClient } from "./ws-client.js";

const isTauri = "__TAURI__" in window;

// ── Tauri invoke helper ──
async function invoke(cmd, args = {}) {
  if (!isTauri) return;
  return window.__TAURI__.core.invoke(cmd, args);
}

// ── Platform detection ──
async function detectPlatform() {
  if (!isTauri) return "desktop";
  try {
    return await invoke("get_platform");
  } catch {
    return "desktop";
  }
}

async function init() {
  const platform = await detectPlatform();
  document.body.classList.add(platform === "ios" ? "mobile" : "desktop");

  if (platform === "ios") {
    initMobile();
  } else {
    initDesktop();
  }
}

// ══════════════════════════════════════════
//  Desktop Mode
// ══════════════════════════════════════════

function initDesktop() {
  // ── URL bar ──
  const urlBar = document.getElementById("url-bar");

  urlBar.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const url = urlBar.value.trim();
    if (!url) return;
    try {
      await invoke("navigate", { url });
    } catch (err) {
      console.error("Navigation failed:", err);
    }
  });

  urlBar.addEventListener("focus", () => urlBar.select());

  // ── Nav buttons ──
  document.getElementById("btn-back").addEventListener("click", () => {
    invoke("browser_back");
  });
  document.getElementById("btn-forward").addEventListener("click", () => {
    invoke("browser_forward");
  });
  document.getElementById("btn-reload").addEventListener("click", () => {
    invoke("browser_reload");
  });

  // ── Danmaku pill toggle ──
  const danmakuPill = document.getElementById("danmaku-pill");
  const danmakuLabel = document.getElementById("danmaku-label");
  let danmakuEnabled = true;

  danmakuPill.addEventListener("click", () => {
    danmakuEnabled = !danmakuEnabled;
    updateDanmakuPill();
    wsClient.sendControl({ action: "toggle", enabled: danmakuEnabled });
  });

  function updateDanmakuPill() {
    danmakuPill.classList.toggle("off", !danmakuEnabled);
    danmakuLabel.textContent = danmakuEnabled ? "弾幕" : "OFF";
  }

  // ── Settings panel ──
  const settingsOverlay = document.getElementById("settings-overlay");
  const btnSettings = document.getElementById("btn-settings");

  btnSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsOverlay.classList.toggle("show");
  });

  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.remove("show");
    }
  });

  // Speed slider
  const speedSlider = document.getElementById("speed-slider");
  const speedValue = document.getElementById("speed-value");
  speedSlider.addEventListener("input", () => {
    speedValue.textContent = speedSlider.value;
    wsClient.sendControl({ action: "set_speed", value: parseInt(speedSlider.value) });
  });

  // Font size slider
  const fontsizeSlider = document.getElementById("fontsize-slider");
  const fontsizeValue = document.getElementById("fontsize-value");
  fontsizeSlider.addEventListener("input", () => {
    fontsizeValue.textContent = fontsizeSlider.value;
    wsClient.sendControl({ action: "set_font_size", value: parseInt(fontsizeSlider.value) });
  });

  // Color picker
  const colorPicker = document.getElementById("color-picker");
  colorPicker.addEventListener("input", () => {
    wsClient.sendControl({ action: "set_color", value: colorPicker.value });
  });

  // Inject button
  document.getElementById("btn-inject").addEventListener("click", async () => {
    const btn = document.getElementById("btn-inject");
    try {
      await invoke("inject_danmaku_script");
      btn.textContent = "注入完了!";
      setTimeout(() => { btn.textContent = "弾幕スクリプトを再注入"; }, 1200);
    } catch (err) {
      console.error("Inject failed:", err);
    }
    settingsOverlay.classList.remove("show");
  });

  // ── QR modal (shows WebSocket URL for mobile connection) ──
  const qrModal = document.getElementById("qr-modal");

  document.getElementById("btn-qr").addEventListener("click", async () => {
    settingsOverlay.classList.remove("show");
    try {
      const svg = await invoke("get_ws_qr");
      const wsUrl = await invoke("get_ws_url");
      document.getElementById("qr-svg").innerHTML = svg;
      document.getElementById("qr-url").textContent = wsUrl;
    } catch {
      document.getElementById("qr-svg").innerHTML = "<p>QR生成失敗</p>";
      document.getElementById("qr-url").textContent = "";
    }
    qrModal.classList.add("show");
  });

  document.getElementById("qr-close").addEventListener("click", () => {
    qrModal.classList.remove("show");
  });
  qrModal.addEventListener("click", (e) => {
    if (e.target === qrModal) qrModal.classList.remove("show");
  });

  // ── WebSocket (desktop connects to local server) ──
  const wsDot = document.getElementById("ws-dot");

  const wsClient = new DanmakuWsClient("ws://localhost:1422/ws", {
    onDanmaku: () => {},
    onControl: (action) => {
      switch (action.action) {
        case "set_speed":
          speedSlider.value = action.value;
          speedValue.textContent = action.value;
          break;
        case "set_color":
          colorPicker.value = action.value;
          break;
        case "toggle":
          danmakuEnabled = action.enabled;
          updateDanmakuPill();
          break;
      }
    },
    onOpen: () => { wsDot.classList.add("connected"); },
    onClose: () => { wsDot.classList.remove("connected"); },
    onError: () => { wsDot.classList.remove("connected"); },
  });

  wsClient.connect();
}

// ══════════════════════════════════════════
//  Mobile Mode (Danmaku Viewer)
// ══════════════════════════════════════════

function initMobile() {
  const canvas = document.getElementById("mobile-danmaku-canvas");
  const connectOverlay = document.getElementById("mobile-connect");
  const wsUrlInput = document.getElementById("mobile-ws-url");
  const connectBtn = document.getElementById("mobile-connect-btn");
  const statusEl = document.getElementById("mobile-status");
  const controls = document.getElementById("mobile-controls");
  const mobileDot = document.getElementById("mobile-ws-dot");
  const mobileLabel = document.getElementById("mobile-ws-label");

  // Resize canvas
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // ── Inline danmaku engine for mobile ──
  const ctx = canvas.getContext("2d");
  const items = [];
  let enabled = true;
  let baseSpeed = 3;
  const defaultColor = "#FFFFFF";
  const defaultFontSize = 32;
  const maxDanmaku = 100;
  const lanes = [];

  function getLaneCount() {
    const lineHeight = defaultFontSize * 1.5;
    return Math.floor(canvas.height / lineHeight);
  }

  function findLane() {
    const laneCount = getLaneCount();
    if (laneCount === 0) return 0;
    while (lanes.length < laneCount) lanes.push(0);
    let minTime = Infinity;
    let bestLane = 0;
    for (let i = 0; i < laneCount; i++) {
      if (lanes[i] < minTime) {
        minTime = lanes[i];
        bestLane = i;
      }
    }
    lanes[bestLane] = Date.now();
    return bestLane;
  }

  function addDanmaku(text, color, speed, fontSize) {
    if (!enabled || !text) return;
    if (items.length >= maxDanmaku) items.shift();

    const fs = fontSize || defaultFontSize;
    const sp = speed || baseSpeed;
    const cl = color || defaultColor;
    const lane = findLane();
    const lineHeight = fs * 1.5;

    ctx.font = `bold ${fs}px "Hiragino Sans", "MS Gothic", sans-serif`;
    const width = ctx.measureText(text).width;

    items.push({
      text, color: cl, fontSize: fs,
      speed: sp * 1.5 + 1,
      x: canvas.width,
      y: lane * lineHeight + fs,
      width, alive: true,
    });
  }

  let lastTime = performance.now();
  function animationLoop(now) {
    const delta = now - lastTime;
    lastTime = now;

    if (enabled) {
      const factor = delta / 16.667;
      for (const item of items) {
        item.x -= item.speed * factor;
        if (item.x + item.width < 0) item.alive = false;
      }
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].alive) items.splice(i, 1);
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const item of items) {
        ctx.font = `bold ${item.fontSize}px "Hiragino Sans", "MS Gothic", sans-serif`;
        ctx.fillStyle = item.color;
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.strokeText(item.text, item.x, item.y);
        ctx.fillText(item.text, item.x, item.y);
      }
    }

    requestAnimationFrame(animationLoop);
  }
  requestAnimationFrame(animationLoop);

  // ── WebSocket connection ──
  let ws = null;

  function connectToServer(url) {
    if (ws) {
      ws.close();
      ws = null;
    }

    statusEl.textContent = "接続中...";
    connectBtn.disabled = true;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      statusEl.textContent = "無効なURL";
      connectBtn.disabled = false;
      return;
    }

    ws.onopen = () => {
      statusEl.textContent = "";
      connectOverlay.classList.add("hidden");
      controls.classList.add("show");
      mobileDot.classList.add("connected");
      mobileLabel.textContent = "接続中";
      connectBtn.disabled = false;

      // Save URL for next time
      try { localStorage.setItem("nicotaurix_ws_url", url); } catch {}
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "danmaku") {
          addDanmaku(msg.text, msg.color, msg.speed, msg.font_size);
        } else if (msg.type === "control") {
          const action = msg.action;
          if (action.action === "toggle") enabled = action.enabled;
          if (action.action === "set_speed") {
            baseSpeed = Math.max(1, Math.min(5, action.value));
          }
        }
      } catch {}
    };

    ws.onclose = () => {
      mobileDot.classList.remove("connected");
      mobileLabel.textContent = "切断";
      connectBtn.disabled = false;
    };

    ws.onerror = () => {
      statusEl.textContent = "接続失敗";
      connectBtn.disabled = false;
      mobileDot.classList.remove("connected");
    };
  }

  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    connectOverlay.classList.remove("hidden");
    controls.classList.remove("show");
    mobileDot.classList.remove("connected");
    statusEl.textContent = "";
  }

  // ── Event listeners ──
  connectBtn.addEventListener("click", () => {
    const url = wsUrlInput.value.trim();
    if (!url) {
      statusEl.textContent = "URLを入力してください";
      return;
    }
    connectToServer(url);
  });

  wsUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") connectBtn.click();
  });

  document.getElementById("mobile-btn-reconnect").addEventListener("click", () => {
    const url = wsUrlInput.value.trim();
    if (url) connectToServer(url);
  });

  document.getElementById("mobile-btn-disconnect").addEventListener("click", () => {
    disconnect();
  });

  // Restore last URL
  try {
    const saved = localStorage.getItem("nicotaurix_ws_url");
    if (saved) wsUrlInput.value = saved;
  } catch {}

  // Tap to hide/show controls
  canvas.addEventListener("click", () => {
    if (controls.classList.contains("show")) {
      controls.style.opacity = controls.style.opacity === "0" ? "1" : "0";
    }
  });
}

// ── Start ──
init();
