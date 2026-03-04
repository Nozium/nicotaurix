/**
 * Danmaku Injection Script for X.com WebView
 *
 * Injected into the X.com WebView by Tauri.
 * Detects Quote Reposts and shows the quoting user's comment as danmaku.
 *
 * Quote Post detection:
 *   A tweet article with 2+ [data-testid="tweetText"] elements is a quote repost.
 *   The first tweetText is the quoting comment → danmaku.
 *   The second is the original quoted tweet → ignored.
 */
(function () {
  "use strict";

  if (window.__nicotaurix_injected) return;
  window.__nicotaurix_injected = true;

  // --- Canvas overlay ---
  const canvas = document.createElement("canvas");
  canvas.id = "nicotaurix-danmaku-canvas";
  canvas.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
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

  // --- Danmaku engine ---
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

    // Broadcast to WebSocket for mobile mirror
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

  // --- Animation loop ---
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

  // --- Quote Repost detection ---
  // Track processed articles to avoid duplicates
  const processed = new WeakSet();

  /**
   * Check if a tweet article is a Quote Repost and extract the comment.
   * Returns the quote comment text, or null if not a quote repost.
   */
  function extractQuoteComment(article) {
    const tweetTexts = article.querySelectorAll('[data-testid="tweetText"]');
    if (tweetTexts.length < 2) return null;

    // First tweetText = quoting user's comment
    // Second tweetText = original quoted tweet (inside embedded card)
    const comment = tweetTexts[0].textContent?.trim();
    return comment && comment.length > 0 ? comment : null;
  }

  function processNode(node) {
    if (node.nodeType !== 1) return;

    // Find tweet articles
    const articles = [];
    if (node.matches?.('article[data-testid="tweet"]')) {
      articles.push(node);
    }
    if (node.querySelectorAll) {
      articles.push(
        ...node.querySelectorAll('article[data-testid="tweet"]')
      );
    }

    for (const article of articles) {
      if (processed.has(article)) continue;
      processed.add(article);

      const comment = extractQuoteComment(article);
      if (comment) {
        addDanmaku(comment);
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        processNode(node);
      }
    }
  });

  function startObserving() {
    const timeline = document.querySelector("main") || document.body;
    observer.observe(timeline, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }

  // --- WebSocket connection ---
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

  // --- Debug API ---
  window.__nicotaurix = {
    addDanmaku,
    getItems: () => [...items],
    setEnabled: (v) => { enabled = v; },
    setSpeed: (v) => { baseSpeed = Math.max(1, Math.min(5, v)); },
    extractQuoteComment,
  };

  console.log("[NicoTauriX] Danmaku injection active (Quote Post mode)");
})();
