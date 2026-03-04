import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for Quote Post detection logic in danmaku-inject.js.
 *
 * Since danmaku-inject.js is an IIFE injected into X.com,
 * we test the core detection logic by simulating the X.com DOM structure.
 */

/**
 * Create a mock tweet article element.
 * @param {Object} opts
 * @param {string[]} opts.tweetTexts - Array of tweet text contents
 * @returns {HTMLElement}
 */
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

/**
 * extractQuoteComment logic extracted for testing.
 * Same logic as in danmaku-inject.js.
 */
function extractQuoteComment(article) {
  const tweetTexts = article.querySelectorAll('[data-testid="tweetText"]');
  if (tweetTexts.length < 2) return null;

  const comment = tweetTexts[0].textContent?.trim();
  return comment && comment.length > 0 ? comment : null;
}

describe("Quote Post Detection", () => {
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
        "This is my commentary!",  // Quote comment
        "Original tweet content",   // Quoted original
      ]);
      expect(extractQuoteComment(article)).toBe("This is my commentary!");
    });

    it("should return the first text for 3+ tweetTexts", () => {
      const article = createTweetArticle([
        "My comment",
        "Quoted tweet text",
        "Some nested text",
      ]);
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
      const article = createTweetArticle([
        "  Comment with spaces  ",
        "Original tweet",
      ]);
      expect(extractQuoteComment(article)).toBe("Comment with spaces");
    });

    it("should handle Japanese text in quote comments", () => {
      const article = createTweetArticle([
        "これはすごい！",
        "元のツイート内容",
      ]);
      expect(extractQuoteComment(article)).toBe("これはすごい！");
    });

    it("should handle emoji in quote comments", () => {
      const article = createTweetArticle([
        "Great take! 🔥🎉",
        "Original content",
      ]);
      expect(extractQuoteComment(article)).toBe("Great take! 🔥🎉");
    });
  });

  describe("DOM structure matching", () => {
    it("should only match article elements with data-testid=tweet", () => {
      // Not an article
      const div = document.createElement("div");
      div.setAttribute("data-testid", "tweet");
      const text1 = document.createElement("div");
      text1.setAttribute("data-testid", "tweetText");
      text1.textContent = "comment";
      div.appendChild(text1);
      const text2 = document.createElement("div");
      text2.setAttribute("data-testid", "tweetText");
      text2.textContent = "original";
      div.appendChild(text2);

      // extractQuoteComment works on any element with querySelectorAll,
      // but processNode in the actual script checks article[data-testid="tweet"]
      // Here we just verify the selector logic
      expect(div.matches('article[data-testid="tweet"]')).toBe(false);
    });

    it("should match article[data-testid=tweet]", () => {
      const article = createTweetArticle(["comment", "original"]);
      expect(article.matches('article[data-testid="tweet"]')).toBe(true);
    });

    it("should find nested tweetText in complex DOM", () => {
      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");

      // Comment in outer div
      const outerDiv = document.createElement("div");
      const commentEl = document.createElement("div");
      commentEl.setAttribute("data-testid", "tweetText");
      commentEl.textContent = "My quote comment";
      outerDiv.appendChild(commentEl);
      article.appendChild(outerDiv);

      // Original in nested blockquote-like container
      const quoteContainer = document.createElement("div");
      quoteContainer.setAttribute("role", "link");
      const originalEl = document.createElement("div");
      originalEl.setAttribute("data-testid", "tweetText");
      originalEl.textContent = "Original post";
      quoteContainer.appendChild(originalEl);
      article.appendChild(quoteContainer);

      expect(extractQuoteComment(article)).toBe("My quote comment");
    });
  });

  describe("Deduplication with WeakSet", () => {
    it("should track processed articles via WeakSet", () => {
      const processed = new WeakSet();
      const article = createTweetArticle(["comment", "original"]);

      expect(processed.has(article)).toBe(false);
      processed.add(article);
      expect(processed.has(article)).toBe(true);
    });

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
      processArticle(article); // duplicate
      processArticle(article); // duplicate

      expect(results).toEqual(["comment"]);
    });
  });
});
