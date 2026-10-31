if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Emulator tests must run under the emulators: use `pnpm test:emu` from the repo root.");
}
