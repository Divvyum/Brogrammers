import { defineConfig } from "vitest/config";

// Unit tests only. Emulator tests: `pnpm test:emu` from the repo root.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/emu/**", "**/node_modules/**"],
    env: {
      NODE_ENV: "test",
      JOBS_DISABLED: "true",
      FIREBASE_PROJECT_ID: "hackos-unit-test",
      DATA_ENC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      HASH_KEY: "unit-test-hash-key",
    },
  },
});
