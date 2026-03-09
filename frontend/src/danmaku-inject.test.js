import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for danmaku-inject.js detection logic.
 *
 * Since danmaku-inject.js is an IIFE injected into X.com,
 * we test the core detection functions by reimplementing them here
 * and simulating the X.com DOM structure.
 */

// ── Reimplemented detection functions (same logic as danmaku-inject.js) ──

function isQuoteComposeDialog(dialog) {
  const tweetTexts = dialog.querySelectorAll('[data-testid="tweetText"]');
  if (tweetTexts.length > 0) return true;
  if (dialog.querySelector('[data-testid="card.wrapper"]')) return true;
  if (dialog.querySelector('[data-testid="quoteTweet"]')) return true;
  return false;
}

function getComposeText(dialog) {
  const textarea = dialog.querySelector('[data-testid="tweetTextarea_0"]');
  if (textarea) {
    const text = textarea.textContent?.trim();
    if (text) return text;
  }
  const textbox = dialog.querySelector('[role="textbox"]');
  if (textbox) {
    const text = textbox.textContent?.trim();
    if (text) return text;
  }
  return null;
}

function extractQuoteComment(article) {
  const tweetTexts = article.querySelectorAll('[data-testid="tweetText"]');
  if (tweetTexts.length < 2) return null;
  const comment = tweetTexts[0].textContent?.trim();
  return comment && comment.length > 0 ? comment : null;
}

// ── Helper: create DOM elements ──

function createTweetArticle(tweetTexts = []) {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  for (const text of tweetTexts) {
    const div = document.createElement("div");
    div.setAttribute("data-testid", "tweetText");
    div.textContent = text;
    article.appendChild(div);
  }
  return article;
}

function createQuoteComposeDialog({ composeText = "", hasQuotedTweet = true } = {}) {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");

  // Compose textarea
  const textarea = document.createElement("div");
  textarea.setAttribute("data-testid", "tweetTextarea_0");
  textarea.setAttribute("role", "textbox");
  textarea.textContent = composeText;
  dialog.appendChild(textarea);

  // Quoted tweet preview (embedded original tweet)
  if (hasQuotedTweet) {
    const quotedTweet = document.createElement("div");
    quotedTweet.setAttribute("data-testid", "tweetText");
    quotedTweet.textContent = "Original tweet being quoted";
    dialog.appendChild(quotedTweet);
  }

  // Post button
  const btn = document.createElement("div");
  btn.setAttribute("data-testid", "tweetButton");
  btn.textContent = "Post";
  dialog.appendChild(btn);

  return dialog;
}

// ═══════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════

describe("Trigger 1: Quote Post Submission Detection", () => {
  describe("isQuoteComposeDialog", () => {
    it("should return true when dialog has tweetText (quoted tweet preview)", () => {
      const dialog = createQuoteComposeDialog({ hasQuotedTweet: true });
      expect(isQuoteComposeDialog(dialog)).toBe(true);
    });

    it("should return false for regular tweet compose (no quoted tweet)", () => {
      const dialog = createQuoteComposeDialog({ hasQuotedTweet: false });
      expect(isQuoteComposeDialog(dialog)).toBe(false);
    });

    it("should return true when dialog has card.wrapper", () => {
      const dialog = document.createElement("div");
      const card = document.createElement("div");
      card.setAttribute("data-testid", "card.wrapper");
      dialog.appendChild(card);
      expect(isQuoteComposeDialog(dialog)).toBe(true);
    });

    it("should return true when dialog has quoteTweet", () => {
      const dialog = document.createElement("div");
      const quote = document.createElement("div");
      quote.setAttribute("data-testid", "quoteTweet");
      dialog.appendChild(quote);
      expect(isQuoteComposeDialog(dialog)).toBe(true);
    });

    it("should return false for empty dialog", () => {
      const dialog = document.createElement("div");
      expect(isQuoteComposeDialog(dialog)).toBe(false);
    });
  });

  describe("getComposeText", () => {
    it("should extract text from tweetTextarea_0", () => {
      const dialog = createQuoteComposeDialog({ composeText: "My quote comment!" });
      expect(getComposeText(dialog)).toBe("My quote comment!");
    });

    it("should trim whitespace", () => {
      const dialog = createQuoteComposeDialog({ composeText: "  spaced out  " });
      expect(getComposeText(dialog)).toBe("spaced out");
    });

    it("should return null for empty text", () => {
      const dialog = createQuoteComposeDialog({ composeText: "" });
      expect(getComposeText(dialog)).toBeNull();
    });

    it("should return null for whitespace-only text", () => {
      const dialog = createQuoteComposeDialog({ composeText: "   " });
      expect(getComposeText(dialog)).toBeNull();
    });

    it("should fall back to role=textbox if tweetTextarea_0 has no text", () => {
      const dialog = document.createElement("div");
      // Empty tweetTextarea_0
      const emptyArea = document.createElement("div");
      emptyArea.setAttribute("data-testid", "tweetTextarea_0");
      emptyArea.textContent = "";
      dialog.appendChild(emptyArea);
      // role=textbox with actual text
      const textbox = document.createElement("div");
      textbox.setAttribute("role", "textbox");
      textbox.textContent = "Fallback text";
      dialog.appendChild(textbox);
      expect(getComposeText(dialog)).toBe("Fallback text");
    });

    it("should handle Japanese text", () => {
      const dialog = createQuoteComposeDialog({ composeText: "これはすごい！🔥" });
      expect(getComposeText(dialog)).toBe("これはすごい！🔥");
    });

    it("should return null when no text elements exist", () => {
      const dialog = document.createElement("div");
      expect(getComposeText(dialog)).toBeNull();
    });
  });

  describe("Quote Post submission flow", () => {
    it("should detect quote compose and extract text on Post click", () => {
      const dialog = createQuoteComposeDialog({
        composeText: "Great take!",
        hasQuotedTweet: true,
      });

      // Simulate the full flow
      const isQuote = isQuoteComposeDialog(dialog);
      expect(isQuote).toBe(true);

      const text = getComposeText(dialog);
      expect(text).toBe("Great take!");
    });

    it("should NOT trigger for regular tweet (no quoted tweet)", () => {
      const dialog = createQuoteComposeDialog({
        composeText: "Just a normal tweet",
        hasQuotedTweet: false,
      });

      expect(isQuoteComposeDialog(dialog)).toBe(false);
      // Would not proceed to getComposeText in real code
    });

    it("should find Post button via data-testid=tweetButton", () => {
      const dialog = createQuoteComposeDialog({ composeText: "test" });
      const btn = dialog.querySelector('[data-testid="tweetButton"]');
      expect(btn).not.toBeNull();
      expect(btn.closest('[role="dialog"]')).toBe(dialog);
    });
  });
});

describe("Trigger 2: Timeline Quote Repost Detection", () => {
  describe("extractQuoteComment", () => {
    it("should return null for a regular tweet (1 tweetText)", () => {
      const article = createTweetArticle(["Just a normal tweet"]);
      expect(extractQuoteComment(article)).toBeNull();
    });

    it("should return null for a tweet with no text", () => {
      const article = createTweetArticle([]);
      expect(extractQuoteComment(article)).toBeNull();
    });

    it("should return the quote comment for a quote repost (2 tweetTexts)", () => {
      const article = createTweetArticle([
        "This is my commentary!",
        "Original tweet content",
      ]);
      expect(extractQuoteComment(article)).toBe("This is my commentary!");
    });

    it("should return the first text for 3+ tweetTexts", () => {
      const article = createTweetArticle(["My comment", "Quoted text", "Nested"]);
      expect(extractQuoteComment(article)).toBe("My comment");
    });

    it("should return null when the quote comment is empty", () => {
      const article = createTweetArticle(["", "Original tweet"]);
      expect(extractQuoteComment(article)).toBeNull();
    });

    it("should return null when the quote comment is whitespace only", () => {
      const article = createTweetArticle(["   ", "Original tweet"]);
      expect(extractQuoteComment(article)).toBeNull();
    });

    it("should trim the quote comment text", () => {
      const article = createTweetArticle(["  Comment  ", "Original"]);
      expect(extractQuoteComment(article)).toBe("Comment");
    });

    it("should handle Japanese text", () => {
      const article = createTweetArticle(["これはすごい！", "元ツイート"]);
      expect(extractQuoteComment(article)).toBe("これはすごい！");
    });
  });

  describe("Deduplication with WeakSet", () => {
    it("should not re-process the same article", () => {
      const processed = new WeakSet();
      const results = [];

      function processArticle(article) {
        if (processed.has(article)) return;
        processed.add(article);
        const comment = extractQuoteComment(article);
        if (comment) results.push(comment);
      }

      const article = createTweetArticle(["comment", "original"]);
      processArticle(article);
      processArticle(article);
      processArticle(article);

      expect(results).toEqual(["comment"]);
    });
  });
});
