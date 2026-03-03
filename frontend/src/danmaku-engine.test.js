import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DanmakuEngine } from "./danmaku-engine.js";

/**
 * Create a mock canvas with a mock 2d context
 */
function createMockCanvas(width = 1920, height = 1080) {
  const ctx = {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text) => ({
      width: text.length * 14,
    })),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };

  return {
    width,
    height,
    getContext: vi.fn(() => ctx),
    _ctx: ctx,
  };
}

describe("DanmakuEngine", () => {
  let canvas;
  let engine;

  beforeEach(() => {
    canvas = createMockCanvas();
    engine = new DanmakuEngine(canvas);
  });

  afterEach(() => {
    engine.stop();
  });

  describe("constructor", () => {
    it("should initialize with default options", () => {
      expect(engine.maxDanmaku).toBe(100);
      expect(engine.baseSpeed).toBe(3);
      expect(engine.defaultColor).toBe("#FFFFFF");
      expect(engine.defaultFontSize).toBe(28);
      expect(engine.enabled).toBe(true);
      expect(engine.items).toEqual([]);
    });

    it("should accept custom options", () => {
      const custom = new DanmakuEngine(canvas, {
        maxDanmaku: 50,
        baseSpeed: 5,
        defaultColor: "#FF0000",
        defaultFontSize: 36,
        enabled: false,
      });
      expect(custom.maxDanmaku).toBe(50);
      expect(custom.baseSpeed).toBe(5);
      expect(custom.defaultColor).toBe("#FF0000");
      expect(custom.defaultFontSize).toBe(36);
      expect(custom.enabled).toBe(false);
    });

    it("should handle null canvas gracefully", () => {
      const nullEngine = new DanmakuEngine(null);
      expect(nullEngine.ctx).toBeNull();
      expect(nullEngine.canvas).toBeNull();
    });
  });

  describe("getLaneCount", () => {
    it("should calculate lanes based on canvas height and font size", () => {
      // height 1080, fontSize 28, lineHeight = 42
      // lanes = floor(1080 / 42) = 25
      expect(engine.getLaneCount()).toBe(25);
    });

    it("should return 0 for null canvas", () => {
      const nullEngine = new DanmakuEngine(null);
      expect(nullEngine.getLaneCount()).toBe(0);
    });

    it("should recalculate when canvas height changes", () => {
      canvas.height = 500;
      // 500 / 42 = 11
      expect(engine.getLaneCount()).toBe(11);
    });
  });

  describe("addDanmaku", () => {
    it("should add a danmaku item with text", () => {
      const item = engine.addDanmaku({ text: "Hello" });
      expect(item).not.toBeNull();
      expect(item.text).toBe("Hello");
      expect(item.alive).toBe(true);
      expect(engine.items.length).toBe(1);
    });

    it("should use default color and speed when not specified", () => {
      const item = engine.addDanmaku({ text: "Test" });
      expect(item.color).toBe("#FFFFFF");
    });

    it("should use custom color and speed when specified", () => {
      const item = engine.addDanmaku({
        text: "Custom",
        color: "#FF0000",
        speed: 5,
        font_size: 36,
      });
      expect(item.color).toBe("#FF0000");
      expect(item.fontSize).toBe(36);
    });

    it("should return null when disabled", () => {
      engine.setEnabled(false);
      const item = engine.addDanmaku({ text: "Hidden" });
      expect(item).toBeNull();
    });

    it("should return null for empty/null text", () => {
      expect(engine.addDanmaku({ text: "" })).toBeNull();
      expect(engine.addDanmaku(null)).toBeNull();
      expect(engine.addDanmaku({ text: null })).toBeNull();
    });

    it("should start from the right edge of canvas", () => {
      const item = engine.addDanmaku({ text: "Right" });
      expect(item.x).toBe(1920); // canvas width
    });

    it("should evict oldest when maxDanmaku exceeded", () => {
      engine.maxDanmaku = 3;
      engine.addDanmaku({ text: "1" });
      engine.addDanmaku({ text: "2" });
      engine.addDanmaku({ text: "3" });
      engine.addDanmaku({ text: "4" });

      expect(engine.items.length).toBe(3);
      expect(engine.items[0].text).toBe("2");
      expect(engine.items[2].text).toBe("4");
    });
  });

  describe("update", () => {
    it("should move items to the left", () => {
      const item = engine.addDanmaku({ text: "Move" });
      const startX = item.x;
      engine.update(16.667); // 1 frame at 60fps
      expect(item.x).toBeLessThan(startX);
    });

    it("should mark off-screen items as dead", () => {
      const item = engine.addDanmaku({ text: "Die" });
      item.x = -100;
      item.width = 50;
      engine.update(16.667);
      expect(item.alive).toBe(false);
    });

    it("should remove dead items", () => {
      engine.addDanmaku({ text: "1" });
      engine.addDanmaku({ text: "2" });
      engine.items[0].alive = false;
      engine.update(0);
      expect(engine.items.length).toBe(1);
      expect(engine.items[0].text).toBe("2");
    });

    it("should not update when disabled", () => {
      const item = engine.addDanmaku({ text: "Frozen" });
      engine.enabled = false;
      const startX = item.x;
      engine.update(100);
      expect(item.x).toBe(startX);
    });

    it("should handle large delta times gracefully", () => {
      const item = engine.addDanmaku({ text: "Fast" });
      engine.update(1000); // ~60 frames worth
      // Should not crash, just moves far left
      expect(item.x).toBeLessThan(1920);
    });
  });

  describe("render", () => {
    it("should call canvas drawing methods", () => {
      engine.addDanmaku({ text: "Draw" });
      engine.render();
      expect(canvas._ctx.clearRect).toHaveBeenCalled();
      expect(canvas._ctx.fillText).toHaveBeenCalledWith(
        "Draw",
        expect.any(Number),
        expect.any(Number)
      );
      expect(canvas._ctx.strokeText).toHaveBeenCalledWith(
        "Draw",
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should not render when disabled", () => {
      engine.setEnabled(false);
      engine.items.push({
        text: "X",
        x: 100,
        y: 100,
        fontSize: 28,
        color: "#FFF",
        speed: 5,
        width: 100,
        alive: true,
      });
      engine.render();
      expect(canvas._ctx.fillText).not.toHaveBeenCalled();
    });

    it("should not crash with null canvas", () => {
      const nullEngine = new DanmakuEngine(null);
      expect(() => nullEngine.render()).not.toThrow();
    });
  });

  describe("setEnabled", () => {
    it("should enable/disable", () => {
      engine.setEnabled(false);
      expect(engine.enabled).toBe(false);
      engine.setEnabled(true);
      expect(engine.enabled).toBe(true);
    });

    it("should clear items when disabled", () => {
      engine.addDanmaku({ text: "Bye" });
      expect(engine.items.length).toBe(1);
      engine.setEnabled(false);
      expect(engine.items.length).toBe(0);
    });
  });

  describe("setSpeed", () => {
    it("should clamp speed between 1 and 5", () => {
      engine.setSpeed(0);
      expect(engine.baseSpeed).toBe(1);
      engine.setSpeed(10);
      expect(engine.baseSpeed).toBe(5);
      engine.setSpeed(3);
      expect(engine.baseSpeed).toBe(3);
    });
  });

  describe("setColor", () => {
    it("should update default color", () => {
      engine.setColor("#00FF00");
      expect(engine.defaultColor).toBe("#00FF00");
    });
  });

  describe("clear", () => {
    it("should remove all items", () => {
      engine.addDanmaku({ text: "1" });
      engine.addDanmaku({ text: "2" });
      engine.clear();
      expect(engine.items.length).toBe(0);
    });

    it("should clear canvas", () => {
      engine.clear();
      expect(canvas._ctx.clearRect).toHaveBeenCalledWith(0, 0, 1920, 1080);
    });
  });

  describe("_measureText", () => {
    it("should use canvas context when available", () => {
      const width = engine._measureText("Test", 28);
      expect(canvas._ctx.measureText).toHaveBeenCalledWith("Test");
      expect(width).toBe(56); // mock returns text.length * 14
    });

    it("should estimate width when no context", () => {
      const nullEngine = new DanmakuEngine(null);
      const asciiWidth = nullEngine._measureText("Test", 28);
      expect(asciiWidth).toBeGreaterThan(0);

      const cjkWidth = nullEngine._measureText("テスト", 28);
      expect(cjkWidth).toBeGreaterThan(asciiWidth);
    });
  });

  describe("lane assignment", () => {
    it("should distribute danmaku across different lanes", () => {
      const items = [];
      for (let i = 0; i < 5; i++) {
        items.push(engine.addDanmaku({ text: `Lane ${i}` }));
      }

      // At least some items should be on different lanes (different y values)
      const yValues = new Set(items.map((item) => item.y));
      expect(yValues.size).toBeGreaterThan(1);
    });
  });
});
