# HACKOS Individual Work Plan — Samrat

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
