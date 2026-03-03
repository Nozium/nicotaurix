import { DanmakuWsClient } from "./ws-client.js";

const isTauri = "__TAURI__" in window;

// ── Tauri invoke helper ──
async function invoke(cmd, args = {}) {
  if (!isTauri) return;
  return window.__TAURI__.core.invoke(cmd, args);
}

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

// ── Nav buttons (back / forward / reload) ──
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

// ── QR modal ──
const qrModal = document.getElementById("qr-modal");

document.getElementById("btn-qr").addEventListener("click", async () => {
  settingsOverlay.classList.remove("show");
  try {
    const svg = await invoke("get_local_qr", { port: 1420 });
    const ip = await invoke("get_local_ip");
    document.getElementById("qr-svg").innerHTML = svg;
    document.getElementById("qr-url").textContent = `http://${ip}:1420`;
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

// ── WebSocket ──
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
