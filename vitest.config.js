import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["frontend/src/**/*.test.{js,ts}", "tests/**/*.test.{js,ts}"],
    globals: true,
  },
});
