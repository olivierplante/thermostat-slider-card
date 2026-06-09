/**
 * Vitest configuration for the thermostat_slider_card frontend tests.
 *
 * The card is a single plain-JS class-based custom element (no build step,
 * no TypeScript). Tests import the exported class and exercise it against
 * jsdom's DOM + a stubbed hass object.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["__tests__/setup.js"],
    include: ["__tests__/**/*.test.js"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["thermostat-slider-card.js"],
      exclude: ["__tests__/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
