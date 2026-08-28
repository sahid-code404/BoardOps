import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["worker/__tests__/**/*.test.ts"],
  },
});
