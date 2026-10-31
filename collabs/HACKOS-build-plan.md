# HACKOS Build Plan

**Team:** Divyam, Aman, Samrat, Manthan
**Goal:** Build HACKOS end to end on a 100% free stack.

| Phase | Who | What |
|---|---|---|
| **Phase 1: Base** | Divyam (backend) + Aman (frontend) | The complete Admin Portal: organizer, volunteer, mentor and judge features, plus the shared foundation (repo, data structure, server, security rules) |
| **Phase 2: Participant side** | Manthan (backend) + Samrat (UI) | The complete Participant Portal, the WhatsApp system, and everything students touch |
| **Phase 3: Integration** | Everyone | End-to-end testing, fixes, demo rehearsal |

Each person's tasks are listed **in the order they should be done**. Every task has a "Done when" line, so you know when to move on.

---

## 0. Decisions (answers to the team questions)

| # | Question | Decision |
|---|---|---|
| 1 | Scope | **Proposed (confirm):** build all core features fully. Build RewardLink, ratings, Community Connect and JourneyLink chats as simpler working versions, demoed with seeded data. |
| 2 | Firebase move | **Decided:** the WhatsApp queue is a **Firestore outbox collection** (no Redis or BullMQ). Check-in sync uses **Firestore offline persistence** plus server-side processing. |
| 3 | Firebase plan | **Decided: everything free (Spark plan).** This rules out Cloud Functions and Firebase Storage. Section 1 lists what replaces them. |
| 4 | WhatsApp number | **Proposed (confirm):** use a spare SIM for Baileys, never a personal number. In the pitch, say production would use the official WhatsApp Business API. |
| 5 | Check-in fallback | **Proposed (confirm):** manual check-in with an override reason, plus a short backup code shown on the participant's ID card. Both are logged in the audit trail. |
| 6 | Rooms offline | **Proposed (confirm):** offline devices only confirm the pre-allotted room. The server rebalances rooms after sync. |
| 7 | Frontend | **Decided: React** (Vite + React + TypeScript) for both portals. |
| 8 | Data structure owner | **Decided:** Divyam owns the Firestore structure and the API contract (section 4). It is **frozen at the end of Phase 1**. Changes after that need agreement from the whole team. |
| 9 | Timeline | **To fill in:** Phase 1 deadline: ____ / Phase 2 deadline: ____ / Demo rehearsal: ____ |
| 10 | Pitch | **To fill in:** Presenter: ____ / Demo driver (phones): ____ |

---

## 1. The free stack (Spark plan) and what changes

On the free Spark plan, **Cloud Functions and Cloud Storage for Firebase are not available**. Cloud Storage has required the paid Blaze plan since February 2026, even at small usage. Everything that would have run in Cloud Functions moves into **one Node.js server**, and file storage moves to free alternatives.

| Need | Free choice | Notes |
|---|---|---|
| Database | **Firestore (Spark)** | Free limits: 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, 1 GB stored. See the quota rules below. |
| Realtime | Firestore `onSnapshot` listeners | Replaces Socket.io |
| Offline | Firestore offline persistence + Dexie (IndexedDB) | Free, built into the SDK |
| Auth | Firebase Auth: Google sign-in, email link, **custom tokens** | Free. **Do not use Firebase phone (SMS) auth**: SMS is not free. The WhatsApp OTP runs through Baileys and our server issues a custom token. |
| Roles | Firebase Auth custom claims (set by our server with the Admin SDK) | Free |
| Backend logic | **One Node.js + Express + TypeScript server** with firebase-admin | Replaces Cloud Functions. Admin routes (Divyam), participant routes (Manthan) and the Baileys worker (Manthan) all run in this **one** server. |
| Scheduled jobs | `node-cron` inside the server | Replaces scheduled Cloud Functions |
| "Triggers" | Server-side Firestore listeners (e.g. `checkins where processed == false`) | Replaces Firestore-triggered functions |
| Server hosting | **Render free web service** | Free services sleep after 15 minutes without traffic. The workspace gets 750 free hours a month, which covers exactly **one** always-on service, so keep it to one server. The disk is wiped on restart, so the Baileys session is stored in Firestore. For the demo, keep it awake, or run the server on a laptop behind a free Cloudflare Tunnel. |
| Frontend hosting | **Firebase Hosting (Spark)**, two sites: `hackos-admin` and `hackos-app` | Free, includes HTTPS (needed for the camera and offline mode) |
| Photos + PPT/PDF files | **Cloudinary free plan** (signed uploads from our server) | Replaces Firebase Storage. Check Cloudinary's current file size limit and compress photos to about 200×200. |
| Demo videos | **YouTube (unlisted) or Google Drive link** | No storage cost or size limit |
| Push notifications | Firebase Cloud Messaging (web push) | Free |
| Email | Nodemailer + Gmail app password (or Resend free tier) | Free with daily limits |
| SMS | **Dropped** | Not free. WhatsApp, push and email cover all messages. |
| AI (announcement drafts, submission summaries) | **Gemini API free tier** (Google AI Studio key) | Rate-limited, fine for a hackathon |
| GitHub insights | GitHub REST API with a personal access token | Free (5,000 requests/hour) |
| PDFs (certificates, reports) | `pdf-lib` on the server | Free |
| Bot protection | Firebase App Check with reCAPTCHA v3 | Free |

### Quota rules (everyone must follow these, or the free plan runs out)

1. **Develop only on the Firebase Emulator Suite** (Firestore + Auth + Hosting emulators). Emulators are free and unlimited. Use the real project only for staging and the demo.
2. **Never listen to an entire large collection.** Always use `where` plus `limit`, and paginate tables (25–50 rows per page).
3. **The dashboard reads one `stats` document**, which the server updates in batches every 10 seconds. It does not count documents live.
4. **Volunteer devices download the roster once** and cache it in Dexie. They re-sync only changed records using the `rosterVersion` number.
5. **Fan-out messages** (for example, one announcement to 300 people) use **batched writes** (up to 500 per batch).
6. **Count with `count()` aggregation queries**, which cost 1 read per 1,000 index entries, never by fetching documents.
7. Check daily usage in the Firebase console (Usage tab) during the build. Whoever sees usage above 70% posts in the group.

---

## 2. Architecture

```
┌──────────────── Firebase Hosting (free) ────────────────┐
│  hackos-admin  (Vite React PWA)  ── Aman, Phase 1         │
│  hackos-app    (Vite React PWA)  ── Samrat, Phase 2       │
└───────────────┬───────────────────────────┬──────────────┘
                │ Firestore SDK (rules)      │ HTTPS + Firebase ID token
                ▼                            ▼
        ┌───────────────┐          ┌──────────────────────────────────┐
        │   Firestore   │◀────────▶│  hackos-server (Render, free)     │
        │  (Spark plan) │  Admin   │  /api/admin/*   ── Divyam         │
        └───────────────┘  SDK     │  /api/p/*       ── Manthan        │
                ▲                  │  /api/public/*  (cert verify)     │
                │                  │  cron jobs + Firestore listeners  │
                │                  │  Baileys worker ── Manthan        │
                │                  └───────┬──────────────┬───────────┘
                │                          │              │
        Firestore offline cache       WhatsApp       Cloudinary, Gemini,
        on volunteer + participant    (Baileys)      GitHub API, Gmail, FCM
        devices
```

**Rule of thumb:** simple reads and writes the user owns go **directly to Firestore**, protected by Security Rules. Anything privileged goes **through the server**: setting roles, signing credentials, OTPs, allotment, scoring locks, aggregation, outbox fan-out, and third-party APIs.

---

## 3. Repo structure (monorepo, pnpm workspaces)

```
hackos/
├── apps/
│   ├── admin/            # Admin Portal (Aman)
│   ├── participant/      # Participant Portal (Samrat)
│   └── server/           # Express server (Divyam: admin modules, Manthan: participant + WhatsApp modules)
│       └── src/
│           ├── core/         firebase.ts, auth.ts, audit.ts, validate.ts, rateLimit.ts, outbox.ts
│           ├── admin/        one folder per feature (Divyam)
│           ├── participant/  one folder per feature (Manthan)
│           ├── whatsapp/     baileys.ts, authState.ts, worker.ts, commands.ts (Manthan)
│           ├── jobs/         cron + listeners
│           └── index.ts
├── packages/
│   ├── shared/           # TS types, zod schemas, enums, crypto utils (Divyam)
│   └── ui/               # shared React components + design tokens (Aman creates, Samrat extends)
├── firebase/
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   └── firebase.json     # hosting targets + emulators
├── scripts/              # seed.ts, gen-organizer-keys.ts, simulate-participant.ts
└── docs/                 # API.md, DATA.md, this plan
```

**Git rules:** `main` is always deployable and `dev` is the integration branch. Each feature goes on its own branch: `feat/<owner>-<feature>`. Merge with a PR, and one other teammate reviews. Never commit `.env` files or keys.

---

## 4. Shared contract (Divyam defines this first in Phase 1; everyone builds against it)

### 4.1 Roles (Firebase Auth custom claims)

`{ role: "superadmin" | "organizer" | "volunteer" | "mentor" | "judge" | "participant", eventId: string }`

### 4.2 Firestore collections

Top level:

| Collection | Purpose | Key fields |
|---|---|---|
| `users/{uid}` | Every person's profile | name, emailHash, emailEnc, phoneHash, phoneEnc, college, year, city, skills[], githubUsername, role, photoUrl |
| `uniqueKeys/{type_hash}` | Enforces one account per phone/email | uid, createdAt |
| `outbox/{messageId}` | WhatsApp/email/push queue | see 4.4 |
| `inbox/{messageId}` | Incoming WhatsApp messages | from, text, receivedAt, processed, command |
| `waSession/{key}` | Encrypted Baileys auth state | data (encrypted) |
| `waStatus/current` | Connection health for the dashboard | state, lastConnectedAt, queued, sentToday, failedToday |
| `certificates/{certId}` | Public verification | uid, eventId, type, issuedAt |
| `templates/{templateId}` | Message templates | channel, body with {{vars}} |

Under `events/{eventId}/…`:

| Subcollection | Purpose |
|---|---|
| (event doc itself) | name, mode (online/offline/hybrid), startAt, endAt, teamMin, teamMax, tracks[], rounds[], eligibilityRules, deadlines{teamLock, submission}, leaderboardVisible, rosterVersion |
| `participants/{uid}` | Registration for this event: status, eligibility{result, reason}, teamId, track, slotId, roomId, seat, checkedInAt, enrollment{status, devicePubKey}, openToReplacement{on, skills, availability}, backupCode |
| `teams/{teamId}` | name, inviteCode, leaderUid, memberUids[], track, status (forming/locked), repoUrl |
| `teamChangeRequests/{id}` | type (join/leave/replace), uid, status, reason |
| `duplicates/{id}` | uidA, uidB, matchType, score, status (open/merged/dismissed) |
| `waitlist/{uid}` | position, eligible, offeredAt, status |
| `replacements/{id}` | teamId, vacantUid, candidates[], currentCandidate, inviteExpiresAt, status |
| `slots/{slotId}` | startAt, endAt, capacity, booked |
| `rooms/{roomId}` | name, floor, capacity, track, occupied, mentorDesk |
| `enrollTokens/{tokenHash}` | uid, expiresAt, used |
| `checkins/{uuid}` | participantId, deviceId, volunteerUid, ts, method (qr/manual/code), result, rejectReason, overrideNote, prevHash, entryHash, processed, flagged |
| `stats/live` | Counters for the dashboard (server-written only) |
| `schedule/{itemId}` | title, startAt, endAt, location, audience |
| `problems/{id}` | track, title, body, releaseAt, released |
| `announcements/{id}` | title, body, audience{type, ids}, emergency, createdBy, sentAt, seenCount |
| `announcements/{id}/seen/{uid}` | seenAt |
| `mentorSlots/{id}` | mentorUid, startAt, teamId, status, notes |
| `progress/{id}` | teamId, text, createdAt |
| `tickets/{id}` | createdBy, roomId, text, assignedTo, status |
| `tasks/{id}` | title, assignedTo, shift, dueAt, status |
| `food/{uid_mealId}` | claimedAt, counter (the deterministic ID blocks double claims) |
| `travelPlans/{uid}` | city, route, mode, departAt, arriveAt |
| `circles/{id}` + `circles/{id}/messages` | members[], route, meetup point |
| `rubric/current` | criteria[{id, name, weight, max}] |
| `judgeAssignments/{judgeUid}` | teamIds[] |
| `submissions/{teamId}` + `submissions/{teamId}/versions/{n}` | pptUrl, videoUrl, repoUrl, submittedAt (server time), version, receiptId, github{commits, contributors, flags}, aiSummary |
| `scores/{judgeUid_teamId}` | criteria{}, total, comment, locked, lockedAt |
| `leaderboard/current` | ranked teams with breakdowns (server-written) |
| `rewards/{id}` | prize, amount, type, sponsor, winnerTeamId, dueAt, status, proofUrl, confirmedAt |
| `complaints/{id}` | rewardId, uid, text, evidenceUrls[], status, deadline, history[] |
| `ratings/{uid}` | scores{organization, mentors, judging, comms, infra, rewards}, text, response |
| `connections/{id}` | fromUid, toUid, status |
| `audit/{id}` | actor, action, target, before, after, reason, ts (**create-only**) |

### 4.3 Status flow (participant)

`registered → eligible | flagged | rejected → team_locked → travel_booked → enrolled → checked_in → room_assigned → submitted → results → reward_received`

### 4.4 Outbox document (shared by Divyam, who enqueues messages, and Manthan, who sends them)

```ts
{
  id: string,                 // deterministic: `${reason}_${refId}_${uid}`, so retries never duplicate
  channel: "whatsapp" | "email" | "push",
  to: { uid: string },        // the worker looks up and decrypts the phone/email
  template: string, vars: Record<string, string>,
  priority: 0 | 1 | 2,        // 0 = emergency
  status: "queued" | "sending" | "sent" | "failed",
  attempts: number, lastError?: string,
  lockedBy?: string, lockedAt?: Timestamp,
  createdAt: Timestamp, sentAt?: Timestamp
}
```

Shared helper (Divyam writes it in `core/outbox.ts`): `enqueue({ channel, uid, template, vars, priority, dedupeKey })`.

### 4.5 Crypto settings (do not change: the server, admin scanner and participant app must match)

ECDSA P-256 with SHA-256, raw 64-byte signatures (IEEE P1363), raw 65-byte public keys, base64url encoding, and canonical JSON (keys sorted, no spaces). The code lives in `packages/shared/crypto`. The protocol follows Samrat's offline check-in guide.

### 4.6 API route list (full details go in `docs/API.md`)

- `/api/admin/*`: staff, events, registrations, duplicates, eligibility, teams, waitlist, replacements, slots, rooms, allotment, enrollment, roster, checkins, schedule, problems, announcements, ai, outbox, mentors, tasks, tickets, food, rubric, judges, submissions, github, scores, leaderboard, certificates, rewards, complaints, ratings, exports, analytics, audit
- `/api/p/*`: auth/otp, profile, registration, teams, matching, replacement, travel, circles, slots, enroll, mentor-booking, progress, tickets, food-pass, submissions, upload-signature, results, rewards, complaints, ratings, connections, fcm-token
- `/api/public/*`: certificate verification, health

---

## 5. PHASE 1: Admin side (Divyam + Aman)

**Goal:** a complete, working Admin Portal on seeded data. Every admin feature works end to end, including the offline volunteer scanner (tested with a participant simulator). WhatsApp messages pile up in the outbox; Manthan's worker sends them in Phase 2.

### 5.1 Divyam: Admin backend + foundation (in order)

**D1. Accounts and project setup**
- Create the Firebase project on **Spark**. Enable Firestore (region `asia-south1`, Mumbai), Auth (Google + email link), and Hosting with two sites (`hackos-admin`, `hackos-app`).
- Create accounts and keys: Cloudinary, Gemini (AI Studio), GitHub personal access token, Gmail app password, Render.
- Set up the monorepo (pnpm workspaces), TypeScript, ESLint, Prettier and `.env.example`.
- Set up the Firebase Emulator Suite (Firestore, Auth, Hosting) in `firebase.json`.
- Add all three teammates to the Firebase project and the repo.
- *Done when:* `pnpm dev` starts the emulators, server and both empty apps.

**D2. `packages/shared`**
- TypeScript types and zod schemas for every collection in section 4.2, plus enums (roles, statuses, check-in reject reasons) and constants.
- Crypto utilities: `encoding.ts`, `canonical.ts`, `verify.ts` (for the browser) and the matching server signing in `apps/server`.
- A unit test that signs on the server and verifies in a browser-like environment (WebCrypto).
- *Done when:* the cross-verification test passes and a one-byte change makes it fail.

**D3. Server skeleton (`apps/server/core`)**
- Express + TypeScript, firebase-admin that connects to the emulator in dev.
- Middleware: Firebase ID token verification, role guard `requireRole(...)`, zod body validation, `express-rate-limit`, `helmet`, CORS for the two site origins, error handler, request logger, App Check token verification (enforced in production).
- `audit.ts`: `writeAudit({ actor, action, target, before, after, reason })`. **Every** admin mutation calls it.
- `outbox.ts`: `enqueue()` helper (section 4.4).
- Encryption helper (AES-256-GCM) for phone and email, plus a SHA-256 hash for lookups.
- `/api/public/health`.
- *Done when:* a protected route rejects users without a token or with the wrong role, and an audit document is written on a test mutation.

**D4. Firestore Security Rules v1 + indexes**
- Rules for all admin-side collections, based on claims: `audit` is create-only for the server and readable only by organizers, `stats` and `leaderboard` are server-write only, volunteers can create check-ins only, judges can read only their assigned teams, and so on.
- Composite indexes in `firestore.indexes.json`.
- Rules unit tests with `@firebase/rules-unit-testing`.
- *Done when:* the rules tests pass for each role (allowed and denied cases).

**D5. Staff and roles**
- Script to bootstrap the first super admin.
- Endpoints: create a staff user (organizer, volunteer, mentor or judge) and set claims, list staff, change role, disable a staff member, and issue a volunteer event PIN for the scanner login. All audited.
- *Done when:* each role can log in and its claims are visible.

**D6. Event setup**
- Event CRUD: mode, dates, team min/max, tracks, rounds, eligibility rules, deadlines, leaderboard visibility.
- Creating an event also initializes the `stats/live` document.
- *Done when:* an event is created through the API and its stats document exists.

**D7. Seed and simulation scripts**
- `seed.ts`: 1 event, 200 participants (some duplicates on purpose), 50 teams, 10 rooms, 6 arrival slots, 5 mentors, 5 judges, 10 volunteers, a rubric, and sample submissions with real public GitHub repos.
- `gen-organizer-keys.ts`: generates the organizer keypair into `.env`.
- `simulate-participant.ts`: creates test device keys and credentials, then generates **response QRs** for a given challenge. Phase 1 uses this to test the scanner without the participant app.
- *Done when:* one command seeds the emulator with realistic data.

**D8. Registrations and duplicates**
- Admin list endpoint (paginated, filters by status, college, track and team).
- CSV import of registrations: validated, with `uniqueKeys` enforced.
- Duplicate detection: exact matches on phone or email hash, plus fuzzy matching on name + college (Jaro-Winkler at or above a threshold). Results are written to `duplicates`.
- Merge endpoint: keeps the earlier record, moves team membership, marks the other as merged, and writes an audit entry. Dismiss endpoint.
- *Done when:* the seeded duplicates appear and merge correctly.

**D9. Eligibility engine**
- Rule evaluator (year, college list, team size, required fields) that sets `eligible`, `flagged` or `rejected`, with a reason.
- Run it for everyone or for one person.
- Manual override with a reason (audited).
- Eligibility results are enqueued in the outbox.
- *Done when:* the seeded data splits into eligible, flagged and rejected with readable reasons.

**D10. Teams (admin)**
- List teams and team details.
- Approve or reject change requests.
- Force-add or remove members (with a reason).
- Team lock at the deadline (`node-cron`), with notifications enqueued.
- *Done when:* teams lock automatically at the deadline and pending requests are blocked.

**D11. Waitlist and replacement engine (core service)**
- Waitlist ordering (registration time + eligibility).
- `replacement.service.ts`:
  - `onWithdraw(teamId, uid)`
  - `findCandidates()`: solo participants who opted in, are eligible and have no team
  - `rank()`: skill fit (complementary skills vs. current team), track and availability
  - `invite(candidate)` with an expiry (outbox message)
  - `next()` when an invitation expires or is declined
  - fallback to the waitlist
- A cron job checks for expired invitations.
- Admin endpoints to approve a replacement, list replacements, and offer waitlist seats.
- Every step is audited.
- Manthan wires the participant accept/decline actions to this service in Phase 2.
- *Done when:* a simulated withdrawal runs the full chain on seeded data (invite, expire, next candidate, accept, admin approve).

**D12. Arrival slots, rooms and allotment**
- Slot CRUD (capacity) and room CRUD (capacity, floor, track, mentor desk).
- Allotment algorithm: process slots in time order, keep teammates together, respect capacity, place a track's teams near that track's mentor desk, and assign seats. Writes `roomId` and `seat` to participants and updates room occupancy (batched).
- Incremental allotment for late bookings.
- Manual move with a reason (audited).
- **Rebalance job:** after a slot ends plus a grace period, releases no-show seats and moves late arrivals into the team's room.
- *Done when:* "Run allotment" on seeded data gives zero capacity violations and keeps every team together.

**D13. Digital ID infrastructure**
- Load the organizer private key from env; `signCredential(payload)`.
- Enrollment tokens: high-entropy, SHA-256 hashed, 48-hour expiry, single use. Bulk "send enrollment links" enqueues links in the outbox.
- Revoke and reissue endpoints (bump `rosterVersion`, audited).
- **Roster endpoint** (volunteer only): `GET /api/admin/roster?since=<version>` returns participants with name, team, room, seat, photo URL, devicePubKey, status, the backup code hash, the revoked list and the `organizerPubKey`.
- *Done when:* the simulator's credentials verify against the roster and a revoked participant appears in the `revoked` list.

**D14. Check-in processor**
- Server listener on `checkins where processed == false` (batched).
- For each device: verify the hash chain (recompute `entryHash` and check the `prevHash` links), and mark the batch `chain_ok` or `chain_broken`.
- Firestore transaction on the participant document: the earliest valid check-in becomes official, later ones get `flagged = true` and `result = duplicate`.
- On a valid check-in: set `checkedInAt`, confirm the room, and enqueue a "Welcome, your room is…" message.
- Manual and backup-code check-ins are recorded in the audit log with their override notes.
- Endpoint for organizers to resolve flagged check-ins.
- *Done when:* two simulated devices check in the same person offline, then sync, and the result is one official record plus one flagged record; editing a log entry is detected as a broken chain.

**D15. Live stats aggregator**
- An in-memory accumulator flushes to `stats/live` every 10 seconds: registrations, eligible, teams, enrolled, arrived per slot vs. expected, room occupancy, submissions, outbox queued/sent/failed, open tickets.
- A nightly job recomputes everything from scratch with `count()` queries to correct any drift.
- *Done when:* the dashboard numbers match a manual count on seeded data.

**D16. Schedule**
- CRUD for schedule items with an audience (everyone, a track, a room).
- On create, change or delete: work out who is affected and enqueue notifications only for them.
- *Done when:* changing a track session queues messages only for that track.

**D17. Problem statements**
- CRUD per track with a `releaseAt` time.
- A cron job releases them on time (sets `released = true`) and enqueues notifications for that track.
- *Done when:* a problem scheduled one minute ahead becomes visible on time.

**D18. Announcements**
- Create an announcement targeted to everyone, a room, a track, a team or a role.
- Fan-out: batched outbox writes with deterministic IDs, plus FCM push to topics (`track_x`, `room_y`, `all`).
- Emergency flag: priority 0, which the worker sends before everything else.
- AI draft endpoint (Gemini): takes short notes and returns a clear announcement.
- Seen tracking: the participant app writes `seen/{uid}`; the server keeps `seenCount` updated.
- *Done when:* an announcement to one room creates exactly that room's outbox messages, and the AI draft works.

**D19. Outbox (admin side)**
- Templates collection with default templates for every message type in the plan.
- WhatsApp dashboard endpoints: reads `waStatus/current` and counts by status, lists failures, retries a failed message (back to `queued`), and searches message history (paginated).
- *Done when:* the dashboard API shows queued messages (they stay queued until Manthan's worker exists).

**D20. Mentors**
- Assign mentors to tracks.
- Generate 15-minute slots from each mentor's availability.
- List bookings per mentor; add mentor notes per team; read team progress updates.
- *Done when:* each seeded mentor has a full slot calendar.

**D21. Volunteer operations**
- Tasks: create, assign, shifts, status updates, plus a reminder cron job (outbox).
- Help-desk tickets: assign to a volunteer and resolve.
- Food and swag: configure meals and counters. The scan endpoint validates the participant's food pass token and creates `food/{uid_mealId}`, which fails if the participant already claimed that meal.
- *Done when:* the same food pass scanned twice is rejected the second time.

**D22. Judging setup**
- Rubric builder (criteria, weights that must total 100, max scores) per round.
- Judge assignment: manual, or automatic balancing so each team gets N judges and no judge is overloaded.
- *Done when:* an auto-assignment produces balanced lists.

**D23. Submissions (admin) + GitHub insights + AI summary**
- Configure the deadline and lock; list submissions with version history.
- GitHub insights service: commits (with timestamps), contributors, additions and deletions, and the README. Commits before the event start or after the deadline are flagged. Commit authors are mapped to team members via `githubUsername`. Results are cached on the submission with a refresh endpoint and a per-repo rate limit.
- AI summary (Gemini) from the README, the project description and a commit summary.
- *Done when:* a seeded public repo shows a correct commit timeline with flags.

**D24. Scoring, leaderboard and results**
- Score endpoint: a judge can only score assigned teams, and submitting locks the score.
- Editing a locked score needs a reason and is audited.
- Consistency check: each judge's average compared with the panel average (z-score); outliers are flagged.
- Leaderboard computation on lock: weighted totals and per-criteria breakdowns, written to `leaderboard/current`.
- Visibility toggle and "publish results" (outbox messages to everyone).
- *Done when:* the seeded scores produce the correct ranking and an outlier judge is flagged.

**D25. Certificates**
- `pdf-lib` templates for participation, winner and mentor certificates, generated on demand (nothing stored, since storage isn't free). Each has a `certificates/{certId}` record.
- Public verify endpoint: `/api/public/certificates/:id`.
- Bulk "issue certificates" enqueues links in the outbox.
- *Done when:* a certificate downloads and its verify link confirms it.

**D26. RewardLink, complaints and ratings (admin side)**
- Reward registry CRUD and status transitions (Announced → Verified → Processing → Delivered / Disputed).
- Proof upload (Cloudinary signed upload).
- Overdue cron job flags late rewards and notifies the organizer.
- Complaints: list, respond, change status, with an escalation cron job past the deadline.
- Ratings: list and organizer response.
- *Done when:* an overdue reward is flagged automatically and a complaint escalates after its deadline.

**D27. Exports**
- CSV exports: attendance, teams, eligibility, check-ins (with flags), scores, leaderboard, rewards, audit log. Streamed, organizer only.
- PDF event summary.
- *Done when:* each export opens correctly in Excel.

**D28. Analytics**
- Registration funnel, attendance rate per slot, no-show rate, WhatsApp delivery rate, average judge spread, rating averages.
- *Done when:* the endpoint returns all metrics for seeded data.

**D29. Security pass**
- Finalize rules for all admin collections.
- Mask phone and email in every response to the volunteer role.
- Rate limits on login, PIN and enrollment.
- Enforce App Check in production.
- Confirm that no secrets are in any client bundle.
- *Done when:* the rules tests and a manual role-by-role check pass.

**D30. Deploy and handoff**
- Deploy the server to Render (env vars set) and the admin site to Firebase Hosting.
- Write `docs/API.md` and `docs/DATA.md`.
- **Freeze the data structure.** Run a 30-minute handoff call with Manthan and Samrat.
- *Done when:* Phase 1 exit checklist (5.3) is complete.

### 5.2 Aman: Admin frontend (in order)

Aman builds the screens for each backend feature as Divyam finishes it. He can start screens early on mock data shaped exactly like the `packages/shared` types.

**A1. Admin app setup + shared UI package**
- `apps/admin`: Vite + React + TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, Firebase SDK (emulator-aware), an API client that attaches the ID token, and react-hook-form + zod (using the shared schemas).
- `packages/ui`: design tokens (colors, typography, spacing, light and dark mode), plus base components (Button, Input, Table with pagination, Modal, Drawer, Tabs, Badge, StatusPill, EmptyState, ErrorState, Skeleton, Toast, ConfirmDialog with a required reason field). Samrat reuses all of these in Phase 2.
- PWA setup (`vite-plugin-pwa`) for the admin app, so the scanner works offline.
- *Done when:* the app shell runs with a side nav and the theme toggle works.

**A2. Auth and role-based navigation**
- Login with Google and email link.
- Read role claims; route guards per role; each role sees only its own menu.
- Unauthorized page.
- Volunteer login with event code + PIN.
- *Done when:* each seeded role lands on its own home screen.

**A3. Staff management** (super admin and organizer)
- Create, list, change role and disable staff; show volunteer PINs.

**A4. Event setup wizard**
- Steps: basics → mode (online/offline/hybrid) → team rules → tracks and rounds → eligibility rules → deadlines → review.

**A5. Live dashboard**
- Reads only `stats/live`.
- Cards and charts (Recharts): registration funnel, eligible vs. flagged, expected vs. arrived per slot, room occupancy grid, submissions count, WhatsApp health, open tickets.
- Alerts: rooms that are full, slots running late.

**A6. Participants**
- Paginated table with search and filters.
- Detail drawer: status timeline, team, slot, room, enrollment status and the audit history for that person.
- Phone and email masked for volunteers.

**A7. Duplicates review**
- Side-by-side comparison of the two records, with Merge and Dismiss buttons (reason required).

**A8. Eligibility review**
- Flagged and rejected lists with reasons; override with a reason; "Re-run rules" button.

**A9. Teams**
- List, team detail, change requests (approve/reject), lock status and countdown, force add/remove (with a reason).

**A10. Waitlist and replacements**
- Ordered waitlist; live replacement chains (candidate, invitation countdown, status); approve replacement; offer a seat.

**A11. Slots and rooms**
- Slot editor (time and capacity), room editor.
- "Run allotment" button with a result summary.
- **Room board:** a grid of rooms showing occupancy, where you can move a participant (reason required).
- Rebalance log.

**A12. Digital ID management**
- Enrollment status per participant (invited / enrolled / revoked); bulk send enrollment links; revoke and reissue.

**A13. Volunteer check-in scanner (offline)**

This is the biggest screen, built as installable PWA routes under `/scan`:
1. Login with event code + PIN.
2. **Roster sync:** downloads into Dexie, including photos as blobs. Shows the roster version and count. "Start check-in" is blocked if the roster is empty.
3. **Home:** checked-in count, "Pending sync: N", "Sync now" (disabled offline), "Start check-in".
4. **Challenge screen:** large challenge QR. Several challenges stay valid for 60 seconds each, so the queue keeps moving.
5. **Scan response** (`html5-qrcode`), then run the **8 checks** with `packages/shared/crypto`, in order: bad QR, forged ID, wrong event/expired, not in roster/revoked, key mismatch, stale challenge, device mismatch, duplicate.
6. **Result screen:** big green VALID with photo, name, team, **room and seat**; or red REJECTED with the reason; "Flag for organizer" on duplicates.
7. **Continuous scan mode** (the camera reopens automatically) and **team check-in mode** (scan members of the same team one after another).
8. **Manual fallback:** search the roster, check in with a reason. **Backup code entry**, checked against the hashed code in the roster.
9. **Local hash-chain log** + log screen with synced/unsynced badges.
10. Each check-in is written to `events/{id}/checkins/{uuid}` with Firestore offline persistence, so it uploads automatically when the internet returns.
- *Done when:* in **airplane mode**, the scanner checks in simulator participants, rejects a reused screenshot (`STALE_CHALLENGE` or `DEVICE_MISMATCH`), and syncs after reconnecting.

**A14. Check-in monitor**
- Live timeline with filters (valid / flagged / rejected / manual / broken chain); resolve flagged check-ins; per-gate counts.

**A15. Schedule editor**
- Timeline view, create and edit sessions with an audience; a "who will be notified" preview.

**A16. Problem statements editor**
- Per track, with a release time and countdown, and a preview.

**A17. Announcements composer**
- Audience picker (all / room / track / team / role), "Draft with AI", preview, emergency toggle (with a confirmation), sent history with seen percentage.

**A18. WhatsApp dashboard**
- Connection state (waiting for the worker in Phase 1), queued/sent/failed counts, failures list with retry, message history search.

**A19. Mentor views**
- My slot calendar, upcoming bookings, team progress feed, notes per team.

**A20. Volunteer operations**
- Organizer: task board (assign, shifts).
- Volunteer: my tasks, help-desk tickets (claim, resolve), and the **food counter scanner** (scan the food pass; it rejects repeat claims).

**A21. Judging setup**
- Rubric builder (shows a live weight total that must equal 100), judge assignment (manual + auto-balance), assignments overview.

**A22. Judge panel** (works well on tablets)
- Assigned teams list with progress.
- Submission viewer: PPT/PDF viewer (Cloudinary URL in an embedded viewer), video embed (YouTube or Drive), **GitHub insights** (commit timeline chart, contributor bars, flagged commits highlighted, README), and the AI summary.
- Rubric scoring form; submit and lock; edit-with-reason for locked scores.

**A23. Results**
- Judge consistency report, leaderboard preview with breakdowns, visibility toggle, publish results, issue certificates.

**A24. RewardLink, complaints and ratings (admin)**
- Reward registry with a status pipeline, proof upload, overdue badges.
- Complaints inbox with respond and escalate.
- Ratings list with responses.

**A25. Exports and analytics pages**
- Export buttons for every CSV and PDF; analytics charts.

**A26. Audit log viewer**
- Filters (actor, action, target, date); before/after diff view.

**A27. Polish**
- Responsive layouts (volunteer and judge screens on phones), loading, empty and error states, toasts, confirmation dialogs, keyboard accessibility.

**A28. Deploy**
- Admin site on Firebase Hosting (`hackos-admin`); confirm the PWA installs and the scanner works offline on two real phones.

### 5.3 Phase 1 exit checklist (both sign off before Phase 2 starts)

- [ ] Every admin feature works on the deployed staging site with seeded data
- [ ] Rules tests pass; every role sees only its own screens and data
- [ ] Offline scanner works in airplane mode with the simulator, and sync + duplicate flagging work
- [ ] Allotment, rebalance, replacement chain, leaderboard and certificates work on seeded data
- [ ] The outbox fills with correct messages (not sent yet)
- [ ] `docs/API.md` and `docs/DATA.md` are written; the data structure is frozen
- [ ] `packages/ui` and `packages/shared` are documented for Samrat and Manthan
- [ ] Daily Firestore usage on staging is under 50% of free limits

---

## 6. PHASE 2: Participant side (Manthan + Samrat)

**Goal:** the complete Participant Portal and WhatsApp system, connected to the Phase 1 base.

### 6.1 Manthan: Student backend + WhatsApp (in order)

**M1. Onboarding to the base**
- Read `docs/API.md`, `docs/DATA.md` and `packages/shared`.
- Create `apps/server/src/participant/` and `whatsapp/`.
- Participant auth middleware (role `participant` + eventId).
- *Done when:* a test participant route works on the emulator.

**M2. Baileys connection**
- Connect with QR login (spare SIM).
- **Custom auth state stored in Firestore** (`waSession`, encrypted), because Render's disk is wiped on restart.
- Batch key updates to save writes.
- Auto-reconnect with backoff; write the connection state to `waStatus/current`.
- *Done when:* the server restarts and WhatsApp reconnects without scanning the QR again.

**M3. Outbox worker**
- Polls or listens to `outbox where status == queued`, ordered by priority then `createdAt`, limit 20.
- **Claims each message in a transaction** (`sending`, `lockedBy`, `lockedAt`), so two workers never send the same message.
- Renders the template, looks up and decrypts the phone number, sends, then marks `sent` or `failed` with the attempt count.
- Exponential retry, up to 5 attempts.
- Recovers stale locks (`sending` older than 2 minutes goes back to `queued`).
- **Send throttling** (about 1 message every 1–2 seconds with jitter) to reduce the ban risk; emergency messages skip ahead.
- Updates the `waStatus` counters.
- Email and push channels use the same worker (Nodemailer, FCM).
- *Done when:* the backlog queued during Phase 1 drains with no duplicates, including after killing the server mid-run.

**M4. Inbox and WhatsApp commands**
- Store incoming messages in `inbox`.
- Find the sender by phone hash.
- Commands: `STATUS`, `MY TEAM`, `MY ROOM`, `SCHEDULE`, `MENTOR`, `SUBMISSION`, `HELP` (case-insensitive), with role-based permissions and a per-sender rate limit.
- Replies go through the outbox. Unknown text gets the HELP reply.
- After a reconnect, missed messages are reconciled.
- *Done when:* each command returns correct live data.

**M5. Participant auth**
- WhatsApp OTP: request (rate-limited), a 6-digit code stored hashed with a 5-minute expiry and 5 attempts, verify, then `createCustomToken`.
- Email link sign-in as the fallback (client side).
- First login creates the `users` document.
- *Done when:* login works with both methods.

**M6. Registration**
- Profile submission (name, college, year, city, skills, track, GitHub username, photo upload signature).
- `uniqueKeys` transaction for phone and email.
- Calls Divyam's duplicate detection and eligibility services.
- Confirmation through the outbox.
- *Done when:* registering twice with the same phone is blocked and eligibility is set automatically.

**M7. Teams (participant)**
- Create a team (generates an invite code), join by code, leave, **withdraw** (calls `replacement.onWithdraw`), and team change requests.
- All of these respect the team lock and team size limits.
- *Done when:* a full team flow works and is blocked after the lock.

**M8. Smart Team Matching**
- Suggestions endpoint: ranked by complementary skills, same track and availability.
- Connect requests (accept/decline) and invitations to a team.
- *Done when:* a solo participant gets sensible suggestions from seeded data.

**M9. Replacement (participant side)**
- "Open to replacement" opt-in with skills and availability.
- Accept or decline an invitation (uses Divyam's service); the team leader confirms; accept or decline a waitlist seat offer.
- *Done when:* the full chain runs from the participant side to the admin approval.

**M10. JourneyLink + arrival slots**
- Save a travel plan.
- Circle matching (same or nearby city, route, date and mode) runs on save plus a cron job.
- Circles: members and a messages subcollection (rules: members only), meetup points, carpool flag.
- **Arrival slot booking** in a transaction with a capacity check, which then triggers incremental room allotment (Divyam's service) and an outbox confirmation.
- *Done when:* two participants with the same route land in the same circle, and a full slot can't be booked.

**M11. Digital ID enrollment**
- `POST /api/p/enroll { token, devicePubKey }`: validates the token hash, checks it's unused and not expired, checks the participant isn't revoked, signs the credential with Divyam's signer, marks the token used, stores the public key, bumps `rosterVersion`, and returns the credential, profile, `organizerPubKey` and backup code.
- Reissue flow for lost phones.
- *Done when:* a real phone enrolls and the admin scanner verifies it.

**M12. Status tracker**
- Keeps the participant's `status` updated at each step (section 4.3), plus a single "my status" endpoint used by the app and the `STATUS` command.

**M13. Schedule, announcements, problems and push**
- Rules for participant reads (released problems only, schedule for their audience).
- Seen receipts for announcements.
- FCM token registration and topic subscriptions (track, room, all).
- *Done when:* a push notification arrives for a track announcement.

**M14. Mentor booking**
- Book in a transaction (one team per slot, at most N bookings per team), cancel, and reminders 10 minutes before (outbox).

**M15. Event-day tools**
- Progress updates (a cron job reminds teams every few hours), help tickets, and the **food pass token** (short-lived signed token shown as a QR).

**M16. Submissions**
- Cloudinary **signed upload** endpoint for PPT/PDF (type and size checks).
- Validation of video links (YouTube/Drive) and the GitHub repo URL.
- **Deadline check uses server time.** Each submission is saved as a new version with a receipt ID and sent through the outbox.
- Triggers the GitHub insights fetch.
- Locked after the deadline.
- *Done when:* a late submission is rejected and a receipt arrives on WhatsApp.

**M17. Results and certificates (participant)**
- Leaderboard read (respects visibility), my team's scores and feedback, certificate download link, data for the public verification page.

**M18. After-event features**
- RewardLink: winner confirms receipt.
- Complaints: create with Cloudinary evidence, track status.
- Ratings: only checked-in participants of completed events, one per participant.
- Community Connect: opt-in directory, connection requests, alumni list.

**M19. Security rules for participant collections**
- Rules and rules tests for every collection a participant touches: own data only, team members only, circle members only.

**M20. Quota and load check**
- Simulate 300 participants on the emulator (registration, slot booking, check-in sync, submissions) and record reads and writes per flow.
- Fix any flow that would exceed the free limits on event day.

**M21. Docs for Samrat**
- Request and response examples for every `/api/p/*` route (Postman collection or `docs/API.md` section).

### 6.2 Samrat: Complete participant UI (in order)

Samrat starts with mock data shaped like the `packages/shared` types and connects each screen as Manthan finishes its endpoint.

**S1. App setup**
- `apps/participant`: Vite + React + TypeScript, Tailwind, `packages/ui`, React Router, TanStack Query.
- Firebase SDK with `persistentLocalCache` (offline).
- **PWA:** `vite-plugin-pwa`, install prompt, offline app shell, offline banner.
- Mobile-first layout with bottom navigation.

**S2. Auth and onboarding**
- WhatsApp OTP login (phone entry, 6-digit code input, resend timer), email link fallback.
- Onboarding profile form (skills chips, track, GitHub username, photo upload with crop and compression).

**S3. Home + status tracker**
- Visual step tracker (section 4.3), the next action card ("Book your arrival slot"), and the latest announcements.

**S4. Registration and eligibility status**
- Eligible, flagged or rejected screens with the reason and what to do next.

**S5. Team hub**
- Create a team or join with a code, member list, leave or withdraw (with a confirmation).
- Smart matching suggestions with connect buttons.
- "Open to replacement" toggle.
- **Replacement invitation screen** with a countdown and accept/decline.
- Waitlist seat offer screen.

**S6. JourneyLink**
- Travel plan form; my circles; circle chat; meetup point; carpool flag.
- **Arrival slot picker** (shows remaining capacity).
- Room and seat card after allotment.

**S7. My ID (offline)**
- Enrollment page: generates a **non-extractable** device key with WebCrypto, stores it in IndexedDB, calls enroll, and saves the credential.
- **ID card** (works offline): photo, name, team, room, and the backup code (tap to reveal).
- **Check-in flow:** scan the volunteer's challenge QR, sign it, then show the response QR full screen with high brightness. It auto-closes after 60 seconds.
- *Done when:* the full check-in works in airplane mode with Aman's scanner.

**S8. Schedule, announcements and problems**
- Live schedule timeline filtered to my track.
- Announcements feed with pinned and emergency styles; marks items seen.
- Push notification permission prompt.
- Problem statements with countdowns, revealed when released.

**S9. Mentor booking**
- Calendar of available slots, book or cancel, my bookings, reminders.

**S10. Event-day tools**
- Progress update form, help ticket form with status, **venue map** (SVG or image with markers for rooms, food, washrooms and mentor desks), and the food pass QR.

**S11. Submission page**
- PPT/PDF upload with progress, video link field (with validation), repo link field.
- Version history, receipt view.
- Deadline countdown and a locked state after the deadline.

**S12. Results**
- Leaderboard (when visible), my team's scores per criteria with judge feedback, certificate download and share.

**S13. After the event**
- RewardLink tracker (status pipeline, confirm receipt), complaints (create with evidence, track), event rating form, Community Connect (directory, connect, alumni).

**S14. Profile and settings**
- Edit profile, notification preferences, linked GitHub username, sign out, reissue ID if the phone changes.

**S15. Polish**
- Loading, empty and error states for every screen; offline states; accessibility (contrast, tap targets, labels); dark mode; Hindi/English-ready text (strings kept in one file).
- Test on two Android phones and one iPhone.

**S16. Final UI consistency pass (with Aman)**
- Same components, spacing, colors and wording across both portals; fix visual bugs from Phase 1.

**S17. Deploy**
- Participant site on Firebase Hosting (`hackos-app`); confirm the PWA installs and works offline.

### 6.3 Phase 2 exit checklist

- [ ] A participant goes from registration to results entirely through the Participant Portal
- [ ] WhatsApp OTP, notifications and all 7 commands work; killing the server never loses or duplicates a message
- [ ] Real phone enrollment + offline check-in with the admin scanner works in airplane mode
- [ ] Replacement chain, JourneyLink circles and slot capacity work from the participant side
- [ ] Submission deadline is enforced by server time; GitHub insights appear for judges
- [ ] Participant rules tests pass
- [ ] The 300-participant simulation stays within free quotas

---

## 7. PHASE 3: Integration and demo (everyone)

1. **Full run-through** of the demo flow on the deployed staging project with fresh seed data (everyone).
2. **Bug bash:** each person tests someone else's module; bugs go into a shared list with an owner.
3. **Edge cases:** double check-in from two gates offline, a dead phone (manual and backup code), a revoked ID, a late submission, a judge outlier, a full slot, a full room, a withdrawal right before the team lock, WhatsApp disconnected mid-announcement.
4. **Demo setup:** spare WhatsApp SIM logged in, 2–3 volunteer phones with the roster synced, 2 participant phones enrolled, a laptop with the admin dashboard, the server kept awake (or run locally with a Cloudflare Tunnel), and screen recordings of every flow as a backup in case the live demo fails.
5. **Demo flow (about 5 minutes):**
   1. Register with WhatsApp OTP; a duplicate is detected and merged
   2. Team Rescue fills a withdrawn spot through a WhatsApp invitation
   3. Travel plan → JourneyLink circle → arrival slot → room pre-allotted
   4. Airplane mode: two-QR check-in shows VALID with the room; a screenshot attack is REJECTED
   5. Announcement sent while WhatsApp is disconnected waits in the outbox
   6. Reconnect: check-ins sync, the duplicate is flagged, messages are delivered once
   7. `MY ROOM` on WhatsApp gets an instant reply
   8. Submission; the judge sees a late commit flagged; scoring; audit log
   9. Leaderboard, certificate verification, reward marked Delivered and confirmed by the winner
6. **Pitch prep:** slides, the "why not blockchain" and "how is this free" answers, and two rehearsals with a timer.

**Closing line:** "From finding your team and travelling together to competing, winning and getting paid. HACKOS works even when the internet doesn't."

---

## 8. Still to decide (reply in the group)

1. Confirm the proposed answers for questions 1, 4, 5 and 6 in section 0.
2. Fill in the Phase 1, Phase 2 and rehearsal dates.
3. Who presents, and who runs the live demo on the phones?
4. Who provides the spare WhatsApp SIM?
5. Who owns the Firebase project and Render account (one shared team Google account is recommended)?
