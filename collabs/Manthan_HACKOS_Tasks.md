# HACKOS Individual Work Plan — Manthan

> This individual file is extracted from the HACKOS Build Plan. The source task text, wording, ownership, dependencies and "Done when" criteria are preserved. Shared technical context, the relevant phase exit checklist, Phase 3 work for everyone, and unresolved team decisions are included so this file can be used independently.

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

## Shared project decisions, stack, architecture and contracts

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
