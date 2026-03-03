/**
 * Danmaku Injection Script for X.com WebView
 *
 * This script is injected into the X.com WebView by Tauri.
 * It hooks into the Quote Repost flow and triggers danmaku
 * for quoted tweet text.
 */
(function () {
  "use strict";

  // Prevent double injection
  if (window.__nicotaurix_injected) return;
  window.__nicotaurix_injected = true;

  // --- Canvas overlay for danmaku ---
  const canvas = document.createElement("canvas");
  canvas.id = "nicotaurix-danmaku-canvas";
  canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 999999;
  `;
  document.body.appendChild(canvas);

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  // --- Inline DanmakuEngine (same logic as danmaku-engine.js) ---
  const ctx = canvas.getContext("2d");
  const items = [];
  let enabled = true;
  let baseSpeed = 3;
  const defaultColor = "#FFFFFF";
  const defaultFontSize = 28;
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
      text,
      color: cl,
      fontSize: fs,
      speed: sp * 1.5 + 1,
      x: canvas.width,
      y: lane * lineHeight + fs,
      width,
      alive: true,
    });

    // Send to WebSocket for PWA mirror
    if (window.__nicotaurix_ws && window.__nicotaurix_ws.readyState === 1) {
      window.__nicotaurix_ws.send(
        JSON.stringify({
          type: "danmaku",
          text,
          color: cl,
          speed: sp,
          font_size: fs,
        })
      );
    }
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
      // Remove dead items
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].alive) items.splice(i, 1);
      }

      // Render
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

  // --- Hook into X.com Quote Repost ---
  // Monitor DOM for new tweets appearing (quote repost submissions)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        // Look for tweet text elements in timeline
        const tweetTexts = node.querySelectorAll
          ? node.querySelectorAll('[data-testid="tweetText"]')
          : [];

        for (const tweetEl of tweetTexts) {
          const text = tweetEl.textContent?.trim();
          if (text && text.length > 0) {
            addDanmaku(text);
          }
        }
      }
    }
  });

  // Start observing once the body is ready
  function startObserving() {
    const timeline = document.querySelector("main") || document.body;
    observer.observe(timeline, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }

  // --- WebSocket connection to Tauri backend ---
  function connectWs() {
    try {
      const ws = new WebSocket("ws://localhost:1422/ws");
      window.__nicotaurix_ws = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "control") {
            const action = msg.action;
            if (action.action === "toggle") enabled = action.enabled;
            if (action.action === "set_speed")
              baseSpeed = Math.max(1, Math.min(5, action.value));
          }
        } catch (e) {
          /* ignore parse errors */
        }
      };

      ws.onclose = () => {
        window.__nicotaurix_ws = null;
        setTimeout(connectWs, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (e) {
      setTimeout(connectWs, 3000);
    }
  }

  connectWs();

  // Expose API for testing/debugging
  window.__nicotaurix = {
    addDanmaku,
    getItems: () => [...items],
    setEnabled: (v) => {
      enabled = v;
    },
    setSpeed: (v) => {
      baseSpeed = Math.max(1, Math.min(5, v));
    },
  };

  console.log("[NicoTauriX] Danmaku injection active!");
})();
