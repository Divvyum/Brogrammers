import { defineConfig } from "vitest/config";

// Unit tests only. Emulator tests: `pnpm test:emu` from the repo root.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/emu/**", "**/node_modules/**"],
  },
});
