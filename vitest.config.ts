import "dotenv/config"; // tests hit the real DB adapter — they need DATABASE_URL from .env
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    // DB tests run against the remote Neon dev branch; each round-trip is
    // hundreds of ms, so the 5s default times out the multi-step API tests.
    testTimeout: 30_000,
  },
});
