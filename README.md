# HACKOS (Brogrammers)

Hackathon operations platform. The full build plan is in [docs/HACKOS-build-plan.md](docs/HACKOS-build-plan.md).

## Repo layout

```
apps/admin          Admin Portal (Vite + React + TS), port 5173
apps/participant    Participant Portal (Vite + React + TS), port 5174
apps/server         Express + firebase-admin API, port 3000
packages/shared     Types, zod schemas, enums, crypto (used by all three apps)
packages/ui         Shared React components and design tokens
firebase/           Firestore rules and indexes
scripts/            Seed and simulation scripts
docs/               Build plan, API.md (routes), DATA.md (collections, frozen)
deploy/             VPS deployment: Caddyfile, systemd unit, step-by-step guide
```

## First-time setup

1. Install **Node.js 22+**, **pnpm** (`npm i -g pnpm`) and **Java 21** (the Firestore emulator needs it).
2. Clone the repo and run `pnpm install`.
3. Create the three `.env` files from their examples and fill in the values Divyam sends you privately:
   - `apps/admin/.env.example` → `apps/admin/.env`
   - `apps/participant/.env.example` → `apps/participant/.env`
   - `apps/server/.env.example` → `apps/server/.env`
4. Run `pnpm dev`, then in a second terminal `pnpm seed --pipeline` to fill the emulators with demo data.

Divyam's machine already has the server keys. Teammates get `apps/server/.env` from Divyam (the keys must match everyone's data); only run `pnpm keys` when setting up a brand-new environment.

`pnpm dev` starts the Firebase emulators (Auth + Firestore, UI at http://127.0.0.1:4000), the server and both apps. Development always runs against the emulators, so it never uses the free-plan quota. Emulator data is saved to `firebase/emulator-data/` when you stop it.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Emulators + server + both apps |
| `pnpm emulators` | Emulators only |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | Browser tests of the admin portal (needs `pnpm dev`, `pnpm seed --pipeline` and `pnpm simulate enroll` first; one-time `npx playwright install chromium`) |
| `pnpm test:emu` | Integration tests against the emulators (starts them itself; stop `pnpm dev` first) |
| `pnpm seed [--pipeline]` | Wipe the emulators and load demo data (`--pipeline` also runs duplicates, eligibility and allotment) |
| `pnpm simulate enroll\|respond\|list` | Fake participant devices for testing the scanner |
| `pnpm superadmin [email]` | Make an account the super admin |
| `pnpm keys` | Generate missing server keys into `apps/server/.env` |
| `pnpm typecheck` | TypeScript check in every package |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |

## Rules

- Never commit `.env` files or the Firebase service account JSON (both are gitignored).
- Branches: `main` is always deployable, `dev` is for integration, features go on `feat/<owner>-<feature>` and merge through a reviewed PR.
- Don't change `packages/shared/src/crypto` without asking Divyam and Samrat: the server, scanner and participant app must match.
