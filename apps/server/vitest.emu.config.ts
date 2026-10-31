import { defineConfig } from "vitest/config";

// Integration tests against the Auth + Firestore emulators. Run from the repo
// root with `pnpm test:emu`, which starts the emulators around them.
export default defineConfig({
  test: {
    include: ["test/emu/**/*.test.ts"],
    setupFiles: ["test/emu/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      JOBS_DISABLED: "true",
      NODE_ENV: "test",
      CLOUDINARY_CLOUD_NAME: "hackos-test",
      CLOUDINARY_API_KEY: "test-key",
      CLOUDINARY_API_SECRET: "test-secret",
    },
  },
});
