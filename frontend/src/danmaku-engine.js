/**
 * DanmakuEngine - Shared danmaku rendering engine
 * Used both in PC WebView injection and PWA mirror mode
 */
export class DanmakuEngine {
  /**
   * @param {HTMLCanvasElement|null} canvas - Canvas element for rendering
   * @param {object} options
   * @param {number} [options.maxDanmaku=100] - Maximum concurrent danmaku
   * @param {number} [options.baseSpeed=3] - Base speed (1-5)
   * @param {string} [options.defaultColor="#FFFFFF"] - Default text color
   * @param {number} [options.defaultFontSize=28] - Default font size in px
   * @param {boolean} [options.enabled=true] - Whether danmaku rendering is active
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.maxDanmaku = options.maxDanmaku ?? 100;
    this.baseSpeed = options.baseSpeed ?? 3;
    this.defaultColor = options.defaultColor ?? "#FFFFFF";
    this.defaultFontSize = options.defaultFontSize ?? 28;
    this.enabled = options.enabled ?? true;

    /** @type {Array<DanmakuItem>} */
    this.items = [];
    this._animationId = null;
    this._lanes = [];
    this._lastTime = 0;
  }

  /**
   * Calculate available lanes based on canvas height and font size
   * @returns {number}
   */
  getLaneCount() {
    if (!this.canvas) return 0;
    const lineHeight = this.defaultFontSize * 1.5;
    return Math.floor(this.canvas.height / lineHeight);
  }

  /**
   * Find the best lane for a new danmaku (least recently used)
   * @returns {number} Lane index
   */
  _findLane() {
    const laneCount = this.getLaneCount();
    if (laneCount === 0) return 0;

    // Initialize lane tracking
    if (this._lanes.length !== laneCount) {
      this._lanes = new Array(laneCount).fill(0);
    }

    // Find lane with smallest timestamp (least recently used)
    let minTime = Infinity;
    let bestLane = 0;
    for (let i = 0; i < laneCount; i++) {
      if (this._lanes[i] < minTime) {
        minTime = this._lanes[i];
        bestLane = i;
      }
    }

    this._lanes[bestLane] = Date.now();
    return bestLane;
  }

  /**
   * Add a danmaku to the rendering queue
   * @param {object} msg
   * @param {string} msg.text
   * @param {string} [msg.color]
   * @param {number} [msg.speed]
   * @param {number} [msg.font_size]
   * @returns {DanmakuItem|null}
   */
  addDanmaku(msg) {
    if (!this.enabled) return null;
    if (!msg || !msg.text) return null;
    if (this.items.length >= this.maxDanmaku) {
      // Remove oldest
      this.items.shift();
    }

    const fontSize = msg.font_size ?? this.defaultFontSize;
    const speed = msg.speed ?? this.baseSpeed;
    const color = msg.color ?? this.defaultColor;
    const lane = this._findLane();
    const lineHeight = fontSize * 1.5;
    const canvasWidth = this.canvas ? this.canvas.width : 1920;

    const item = {
      text: msg.text,
      color,
      fontSize,
      speed: speed * 1.5 + 1, // Convert 1-5 to actual pixel speed
      x: canvasWidth,
      y: lane * lineHeight + fontSize,
      width: this._measureText(msg.text, fontSize),
      alive: true,
    };

    this.items.push(item);
    return item;
  }

  /**
   * Measure text width
   * @param {string} text
   * @param {number} fontSize
   * @returns {number}
   */
  _measureText(text, fontSize) {
    if (this.ctx) {
      this.ctx.font = `bold ${fontSize}px "Hiragino Sans", "MS Gothic", sans-serif`;
      return this.ctx.measureText(text).width;
    }
    // Estimate: ~0.6em per character for CJK, ~0.5em for ASCII
    return text.split("").reduce((w, c) => {
      return w + (c.charCodeAt(0) > 127 ? fontSize * 0.9 : fontSize * 0.55);
    }, 0);
  }

  /**
   * Update positions and remove off-screen items
   * @param {number} deltaMs - Milliseconds since last update
   */
  update(deltaMs) {
    if (!this.enabled) return;

    const factor = deltaMs / 16.667; // Normalize to ~60fps

    for (const item of this.items) {
      item.x -= item.speed * factor;
      if (item.x + item.width < 0) {
        item.alive = false;
      }
    }

    this.items = this.items.filter((item) => item.alive);
  }

  /**
   * Render all danmaku to canvas
   */
  render() {
    if (!this.ctx || !this.canvas) return;
    if (!this.enabled) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const item of this.items) {
      this.ctx.font = `bold ${item.fontSize}px "Hiragino Sans", "MS Gothic", sans-serif`;
      this.ctx.fillStyle = item.color;
      this.ctx.strokeStyle = "#000000";
      this.ctx.lineWidth = 2;
      this.ctx.strokeText(item.text, item.x, item.y);
      this.ctx.fillText(item.text, item.x, item.y);
    }
  }

  /**
   * Start the animation loop
   */
  start() {
    if (this._animationId) return;
    this._lastTime = performance.now();

    const loop = (now) => {
      const delta = now - this._lastTime;
      this._lastTime = now;
      this.update(delta);
      this.render();
      this._animationId = requestAnimationFrame(loop);
    };

    this._animationId = requestAnimationFrame(loop);
  }

  /**
   * Stop the animation loop
   */
  stop() {
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
  }

  /**
   * Clear all danmaku
   */
  clear() {
    this.items = [];
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Set enabled state
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Set base speed
   * @param {number} speed - 1 to 5
   */
  setSpeed(speed) {
    this.baseSpeed = Math.max(1, Math.min(5, speed));
  }

  /**
   * Set default color
   * @param {string} color - Hex color string
   */
  setColor(color) {
    this.defaultColor = color;
  }
}

/**
 * @typedef {object} DanmakuItem
 * @property {string} text
 * @property {string} color
 * @property {number} fontSize
 * @property {number} speed
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {boolean} alive
 */
