# HACKOS Individual Work Plan — Aman

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

## 5. PHASE 1: Admin side (Divyam + Aman)

**Goal:** a complete, working Admin Portal on seeded data. Every admin feature works end to end, including the offline volunteer scanner (tested with a participant simulator). WhatsApp messages pile up in the outbox; Manthan's worker sends them in Phase 2.

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
