# HACKOS API (admin side, Phase 1)

Base URL in dev: `http://localhost:3000` (the Vite apps proxy `/api` to it).
Request and response bodies are JSON. Dates go both ways as ISO strings. Request
schemas live in `packages/shared/src/api.ts` — use them for form validation so the
client and server agree.

## Participant API (M1–M21)

Public endpoints (App Check is enforced when configured):

| Method | Route | Body |
|---|---|---|
| POST | `/api/p/auth/otp/request` | `{ phone, eventId }` |
| POST | `/api/p/auth/otp/verify` | `{ phone, eventId, code }` → Firebase custom token |
| POST | `/api/p/enroll` | `{ eventId, token, devicePubKey }` |

All remaining routes require a participant Firebase ID token. The event is taken
from its custom claim; clients cannot select another event.

| Area | Routes |
|---|---|
| Profile/status | `GET /me`, `GET /status`, `PUT /registration`, `POST /upload-signature` |
| Teams | `POST /teams`, `POST /teams/join`, `POST /teams/leave`, `POST /teams/withdraw`, `GET /teams/mine`, `POST /team-requests`, `GET /matching` |
| Matching/community | `POST /connections`, `POST /connections/:id/respond`, `GET /community`, `PUT /community/opt-in` |
| Replacement | `PUT /replacement/open`, `POST /replacements/:id/accept|decline`, `POST /waitlist/respond` |
| JourneyLink | `PUT /travel`, `GET /circles/mine`, `POST /circles/:id/messages`, `POST /slots/:slotId/book` |
| Digital ID | `POST /id/reissue` (initial enrollment uses the public route) |
| Event content | `GET /schedule`, `GET /problems`, `GET /announcements`, `POST /announcements/:id/seen`, `PUT /fcm-token` |
| Mentors | `GET /mentor-slots`, `POST|DELETE /mentor-slots/:id/book` |
| Event day | `POST /progress`, `POST /tickets`, `GET /food-pass` |
| Submission/results | `POST /submissions`, `GET /results`, `GET /certificates` |
| After event | `POST /rewards/:id/confirm`, `POST /complaints`, `POST /ratings` |

WhatsApp commands are case-insensitive: `STATUS`, `MY TEAM`, `MY ROOM`,
`SCHEDULE`, `MENTOR`, `SUBMISSION`, and `HELP`. Replies are queued through the
same transactional outbox as notifications.

### WhatsApp login and smoke test

1. Set `WA_ENABLED=true`, `WA_PRINT_QR=true`, Firebase credentials/emulator
   settings, `DATA_ENC_KEY`, and `HASH_KEY` in `apps/server/.env`.
2. Start the server with `pnpm --filter @hackos/server start`.
3. In WhatsApp on the spare SIM: **Linked devices → Link a device**, then scan
   the terminal QR.
4. Confirm `waStatus/current.state == "connected"` and encrypted documents exist
   in `waSession`.
5. Restart the server. It must reconnect without another QR. Send `HELP` from a
   registered participant phone and confirm exactly one outbox reply is sent.

Never use a personal WhatsApp number. Baileys is unofficial; production should
use the official WhatsApp Business API.

## Auth

Every `/api/admin/*` route except the volunteer login needs a Firebase ID token:

```
Authorization: Bearer <await auth.currentUser.getIdToken()>
```

The role comes from custom claims `{ role, eventId }` (read them in the app with
`getIdTokenResult()`). The super admin has `eventId: "*"` and can do everything.
Routes under `/events/:eventId` reject accounts from other events.

## Errors

```json
{ "error": "VALIDATION", "message": "Invalid input", "details": { ... } }
```

| Status | `error` | When |
|---|---|---|
| 400 | `VALIDATION`, `BAD_REQUEST`, `BAD_JSON` | Bad input (`details` has per-field messages for `VALIDATION`) |
| 401 | `UNAUTHENTICATED`, `BAD_LOGIN` | Missing/expired token, wrong event code or PIN |
| 403 | `FORBIDDEN` | Wrong role or wrong event |
| 404 | `NOT_FOUND` | |
| 409 | `CONFLICT` | State doesn't allow it (team locked, room full, already merged, …) |
| 429 | `RATE_LIMITED` | Login/PIN: 10 attempts per 15 minutes per IP |

## Pagination

List routes take `?limit=25&after=<next>` and return `{ items, next }`; `next` is
`null` on the last page.

## Reasons

Every admin change is written to the audit log. Overrides, merges, moves, revokes
and force changes require `reason` (at least 3 characters).

---

## Routes

Roles: **SA** super admin, **O** organizer, **V** volunteer, **M** mentor. SA can call everything.

### Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/health` | `{ status, firestore, emulators }` |
| POST | `/api/admin/auth/volunteer-login` | `{ eventCode, pin }` → `{ token, eventId, name, deviceId }`. Sign in with `signInWithCustomToken(auth, token)`. Keep `deviceId` on the device. |

### Staff (D5) — `/api/admin/staff`

| Method | Path | Who | Body / notes |
|---|---|---|---|
| POST | `/` | O | `{ email, name, role, eventId? }`. Organizers create volunteer/mentor/judge in their own event; only SA creates organizers. |
| GET | `/` | O | `{ items: [{ uid, name, email, role, eventId, disabled, hasPin }] }` |
| PATCH | `/:uid/role` | O | `{ role, reason }`. Takes effect at the person's next sign-in. |
| POST | `/:uid/disable` | O | `{ disabled, reason }` |
| POST | `/:uid/pin` | O | Volunteers only. Returns `{ pin }` once; show it, it can't be read again (issue a new one instead). |

### Events (D6) — `/api/admin/events`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/` | SA | `EventBody`. Also creates `stats/live`. `code` is what volunteers type at login. |
| GET | `/` | any | SA: all events; others: their own. |
| GET | `/:eventId` | any in event | |
| PATCH | `/:eventId` | O | Any subset of `EventBody` (not `code`). |

### Per event — `/api/admin/events/:eventId/...`

**Registrations and duplicates (D8)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `participants` | O, V | Filters: `status`, `college`, `track`, `teamId`. |
| GET | `participants/:uid` | O, V | Adds `profile` (email/phone **masked for volunteers**) and `audit` (organizers only). |
| POST | `registrations/import` | O | `{ csv }`. Columns: `name,email,phone,college,year,city,skills,githubUsername,track,teamName` (skills split by `;` or `\|`). Returns `{ created, teamsCreated, errors: [{ row, message }], duplicatesFound }`. |
| POST | `duplicates/detect` | O | Re-runs detection. |
| GET | `duplicates?status=open` | O | `{ uidA, uidB, matchType: phone\|email\|fuzzy, score, status }` |
| POST | `duplicates/:id/merge` | O | `{ reason }` → `{ kept, merged }`. Keeps the earlier registration. |
| POST | `duplicates/:id/dismiss` | O | `{ reason }` |

**Eligibility (D9)**

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `eligibility/run` | O | `{ uid? }` → `{ eligible, flagged, rejected, changed, skipped }`. Overrides are kept. |
| POST | `participants/:uid/eligibility` | O | `{ result, reason }` — manual override. |

**Teams (D10)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `teams` | O, M | Filters: `status`, `track`. |
| GET | `teams/:teamId` | O, M | Includes `members`. |
| GET | `team-requests?status=pending` | O | |
| POST | `team-requests/:id/decision` | O | `{ decision: approved\|rejected, reason? }`. Approving is blocked after the team lock. |
| POST | `teams/:teamId/members` | O | `{ uid, reason }` force add (works on locked teams). |
| DELETE | `teams/:teamId/members/:uid` | O | `{ reason }` force remove. |
| POST | `teams/lock` | O | Lock now instead of waiting for the deadline (a cron job locks at `deadlines.teamLock`). |

**Waitlist and replacements (D11)**

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `teams/:teamId/withdraw` | O | `{ uid, reason }` → the replacement record; the best candidate is invited immediately. |
| GET | `replacements?status=` | O | `status`: searching, invited, waitlist, accepted, approved, failed. `currentCandidate` + `inviteExpiresAt` drive the countdown. |
| POST | `replacements/:id/approve` | O | After the candidate accepts. |
| GET | `waitlist` | O | Ordered by `position` (eligible people first, then registration time). |
| POST | `waitlist` | O | `{ uids }` → `{ added, skipped: [{ uid, reason }] }`. Skips people in a team, merged records and existing entries. |
| POST | `waitlist/recompute` | O | |
| POST | `waitlist/:uid/offer` | O | Sets `offerExpiresAt` (same window as replacement invites); unanswered offers expire by cron. |

**Slots, rooms, allotment (D12)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | `slots` | O (GET: O, V) | `{ startAt, endAt, capacity }` |
| PATCH/DELETE | `slots/:id` | O | Can't shrink below `booked` or delete a booked slot. |
| GET/POST | `rooms` | O (GET: O, V, M) | `{ name, floor, capacity, track?, mentorDesk }` |
| PATCH/DELETE | `rooms/:id` | O | |
| POST | `allotment/run` | O | → `{ assigned, groups, unassigned, capacityViolations, splitTeams }` |
| POST | `allotment/rebalance` | O | Also runs every 5 minutes by cron. |
| POST | `participants/:uid/move` | O | `{ roomId, reason }` |

**Digital ID (D13)**

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `enrollment/send` | O | `{ uids? }`. Without `uids`: every eligible participant not yet invited. |
| POST | `participants/:uid/revoke` | O | `{ reason }` |
| POST | `participants/:uid/reissue` | O | `{ reason }` — new link, old device stops working. |
| GET | `roster?since=<version>` | V, O | See below. |

Roster response:

```jsonc
{
  "eventId": "…", "rosterVersion": 7, "organizerPubKey": "<base64url, 65 bytes>",
  "participants": [{
    "participantId": "p001", "name": "…", "college": "…", "teamId": "…", "teamName": "…",
    "roomId": "…", "seat": "D101-1", "photoUrl": null,
    "devicePubKey": "<base64url>" , "status": "invited|enrolled|revoked",
    "backupCodeHash": "<hex>", "checkedInAt": null
  }],
  "revoked": ["p077"],   // revoked among the changed records
  "removed": ["p181"]    // merged or withdrawn: delete from the device
}
```

Save `rosterVersion` and pass it as `since` next time to get only changes.
Check a typed backup code with `backupCodeHash(eventId, code)` from `@hackos/shared/crypto`.

**Check-ins (D14)**

The scanner writes each check-in **directly to Firestore** (works offline):
`events/{eventId}/checkins/{uuid}` with exactly these fields:

```
participantId, deviceId, volunteerUid, ts (ISO), method (qr|manual|code),
result (valid|duplicate|rejected), rejectReason?, overrideNote?, prevHash, entryHash,
processed: false, flagged: false
```

`entryHash = computeEntryHash({ id: uuid, eventId, ...those fields without entryHash/processed/flagged })`
and `prevHash` is the previous entry's `entryHash` on this device (`"GENESIS"` for the first).
The server processes them automatically and sets `processed`, `chain` (ok|broken),
`flagged` and `serverResult` (official|duplicate|rejected|broken). It never changes the
device's own fields.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `checkins?filter=` | O | `all`, `valid`, `flagged`, `rejected`, `manual`, `broken`; newest first. |
| POST | `checkins/:id/resolve` | O | `{ action: dismissed\|made_official, reason }` |
| POST | `checkins/process` | O | Process now (normally automatic). |

**Stats (D15)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `stats` | O | Same as the `events/{id}/stats/live` document (listen to that for live updates). |
| POST | `stats/recompute` | O | Full recount. Also runs nightly at 03:00 IST. |

**Schedule (D16)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `schedule` | O, V, M, J | |
| POST | `schedule` | O | `{ title, startAt, endAt, location?, audience: { type: all\|track\|room\|team\|role, ids } }` → `{ id, notified }` |
| PATCH | `schedule/:id` | O | Same body. Notifies the old **and** new audience. |
| DELETE | `schedule/:id` | O | Sends a cancellation. |
| POST | `schedule/preview-audience` | O | `{ audience }` → `{ count }` for the "who will be notified" preview. |

**Problem statements (D17)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `problems` | O, M, J | |
| POST/PATCH | `problems`, `problems/:id` | O | `{ track, title, body, releaseAt }`. After release only title/body can change. |
| DELETE | `problems/:id` | O | Not after release. |
| POST | `problems/:id/release` | O | Release now. Otherwise a cron job releases at `releaseAt` and notifies the track. |

**Announcements (D18)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `announcements` | O | Newest first, with `recipients`, `seenCount`, `seenPct`. |
| POST | `announcements` | O | `{ title, body, audience, emergency }` → `{ id, recipients, queued, pushed }`. Emergency = priority 0. Also pushes FCM topics `all`, `track_X`, `room_X`, `team_X`, `role_X`. |
| POST | `announcements/preview-audience` | O | `{ audience }` → `{ count }` |
| POST | `announcements/ai-draft` | O | `{ notes, tone: friendly\|formal\|urgent }` → `{ title, body }`. Can take ~20 s when Gemini is busy. |

**Outbox / WhatsApp dashboard (D19)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `outbox/status` | O | `{ connection, counts: { queued, sending, sent, failed } }`. `connection.waitingForWorker` until Phase 2. |
| GET | `outbox/messages` | O | Filters `status`, `template`, `uid`; paginated, newest first. |
| POST | `outbox/:id/retry` | O | Failed → queued. |
| GET | `/api/admin/templates` | O | All templates, with `isDefault`. |
| PUT | `/api/admin/templates/:id` | O | `{ channel, body }` |
| POST | `/api/admin/templates/defaults` | O | Creates missing defaults (also done at server start). |

**Mentors (D20)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `mentors` | O | With `tracks`, `slots`, `booked`. |
| PUT | `mentors/:uid/tracks` | O | `{ tracks }` |
| POST | `mentors/:uid/availability` | O, the mentor | `{ windows: [{ startAt, endAt }], slotMinutes = 15 }` → `{ created }` (re-sending creates no duplicates). |
| GET | `mentor-slots?mentorUid=&status=` | O, M (own only) | Time order. |
| PATCH | `mentor-slots/:id/notes` | O, the mentor | `{ notes }` |
| GET | `teams/:teamId/progress` | O, M | `{ progress, mentorNotes }` |

**Volunteer operations (D21)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `tasks` | O (all), V (own) | |
| POST | `tasks` | O | `{ title, assignedTo?, shift?, dueAt? }`. One WhatsApp reminder 30 min before `dueAt`. |
| PATCH | `tasks/:id` | O; V own (status/notes) | |
| GET | `tickets?status=` | O, V | |
| POST | `tickets/:id/assign` | O; V (claim for self) | `{ assignedTo }` |
| POST | `tickets/:id/resolve` | O; V (if claimed) | `{ resolution }` |
| GET/PUT | `food/config` | GET O, V; PUT O | `{ meals: [{ id, name, startAt, endAt }], counters }` |
| POST | `food/scan` | V, O | `{ token, mealId, counter }` → `{ ok, name, meal }`. 409 `ALREADY_CLAIMED` (with `details.claimedAt/counter`), 409 `MEAL_NOT_ACTIVE`, 400 `BAD_FOOD_PASS`. |
| GET | `food/stats` | O | Claims per meal. |

**Judging (D22, D24)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/PUT | `rubric/:round` | GET O, J; PUT O | `{ criteria: [{ id, name, weight, max }] }`, weights total 100. Frozen once a score in that round is locked. Default round: `current`. |
| GET | `judges` | O | With `teamIds`. |
| PUT | `judges/:uid/assignments` | O | `{ teamIds }` |
| POST | `judges/auto-assign` | O | `{ judgesPerTeam = 2 }` → `{ loads }` (balanced within one team). |
| GET | `scores?round=` | O (all), J (own) | |
| PUT | `scores/:teamId` | J (assigned teams); O with `?judgeUid=` | `{ criteria, comment?, submit, reason?, round }` → `{ total, locked }`. `submit: true` locks. Changing a locked score needs `reason` (audited). |
| GET | `leaderboard` | O, J | `{ teams: [{ rank, teamId, teamName, total, breakdown, judges }], outlierJudges, consistency }` |
| POST | `leaderboard/recompute` | O | Also recomputed whenever a score locks. |
| GET | `judging/consistency` | O | Per judge: `average`, `count`, `z`; outliers at \|z\| ≥ 1.5. |
| POST | `results/visibility` | O | `{ visible }` |
| POST | `results/publish` | O | Makes the leaderboard visible and notifies everyone. |

**Submissions (D23)**

| Method | Path | Who | Notes |
|---|---|---|---|
| PUT | `submissions/settings` | O | `{ deadline?, locked? }` |
| GET | `submissions` | O; J (assigned) | Summary list (GitHub counts only). |
| GET | `submissions/:teamId` | O; J (assigned) | Full record with `github.timeline`, `contributors`, `flags`, `outsiders`, `readme`, and `versions`. |
| POST | `submissions/:teamId/github/refresh` | O; J (assigned) | At most once per 10 min per repo (429 otherwise). |
| POST | `submissions/:teamId/ai-summary` | O | → `{ aiSummary }` |

**Certificates (D25)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `certificates` | O | |
| POST | `certificates/issue` | O | `{ type: participation\|winner\|mentor, uids?, topTeams = 3 }`. Participation = checked-in people; winner = top teams' members; never issued twice. |
| GET | `/api/public/certificates/:id` | public | `{ valid, type, name, eventName, rank, teamName, issuedAt }` |
| GET | `/api/public/certificates/:id/pdf` | public | The PDF, generated on demand. |

**RewardLink, complaints, ratings (D26)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | `rewards` | O | `{ prize, amount?, type, sponsor?, winnerTeamId?, dueAt }` |
| PATCH | `rewards/:id` | O | Any subset; a new future `dueAt` clears `overdue`. |
| POST | `rewards/:id/status` | O | `{ status, note? }`. Announced → Verified → Processing → Delivered; Disputed from any; Delivered needs proof. |
| POST | `uploads/sign` | O | `{ folder: reward-proofs\|complaint-evidence }` → Cloudinary signed-upload params. |
| POST | `rewards/:id/proof` | O | `{ proofUrl }` — must be on our Cloudinary account. |
| GET | `complaints?status=` | O | |
| POST | `complaints/:id/respond` | O | `{ note, status? }`. Cron escalates unresolved complaints past `deadline`. |
| GET | `ratings` | O | `{ count, averages, items }` |
| POST | `ratings/:uid/response` | O | `{ response }` |

**Exports and analytics (D27, D28)**

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `exports/{attendance,teams,eligibility,checkins,scores,leaderboard,rewards,audit}.csv` | O | UTF-8 with BOM, CRLF — opens directly in Excel. |
| GET | `exports/summary.pdf` | O | One-page event summary. |
| GET | `analytics` | O | `funnel`, `statusCounts`, `attendanceBySlot`, `attendanceRate`, `noShowRate`, `whatsappDeliveryRate`, `averageJudgeSpread`, `ratings`. |

### Cron jobs (server)

| Every | Job |
|---|---|
| 10 s | live stats flush |
| 1 min | team lock at deadline, replacement invite expiry, waitlist offer expiry, problem release, task reminders, announcement seen counts |
| 5 min | room rebalance after each slot |
| 10 min | overdue rewards, complaint escalation |
| 03:00 IST | full stats recount |

---

## For Manthan (Phase 2)

Server functions to call from `/api/p/*` instead of re-implementing them:

| Need | Call |
|---|---|
| Enroll a device | `enrollWithToken(eventId, token, devicePubKey)` in `admin/digital-id/credentials.ts` |
| Withdraw / accept / decline a replacement | `onWithdraw`, `accept`, `decline` in `admin/replacement/replacement.service.ts` |
| Accept / decline a waitlist seat offer | `respondToOffer(eventId, uid, accepted)` in `admin/replacement/waitlist.ts` (offers with a `replacementId` go through `accept`/`decline` instead) |
| Seat a late slot booking | `allotOne(eventId, uid)` in `admin/allotment/allotment.service.ts` |
| Team join/leave inside a transaction | `addMemberTx`, `removeMemberTx` in `admin/teams/membership.ts` |
| Eligibility for a new registration | `runEligibility(eventId, uid)` in `admin/eligibility/engine.ts` |
| Duplicates after registration | `detectDuplicates(eventId)` in `admin/registrations/duplicates.ts` |
| Queue a message | `enqueue({ channel, uid, template, vars, dedupeKey, eventId })` in `core/outbox.ts` |
| Phone/email storage and lookup | `encrypt`, `decrypt`, `hashPhone`, `hashEmail` in `core/crypto.ts` |
| Food pass QR | `issueFoodPass(eventId, uid)` in `core/foodpass.ts` (valid 15 min) |
| Signed Cloudinary uploads (photos, PPT/PDF, evidence) | `signUpload(folder, eventId)`, `isOurCloudinaryUrl` in `core/cloudinary.ts` |
| GitHub insights after a submission | `refreshGithub(eventId, teamId, true)` in `admin/submissions/routes.ts` |
| Render a message for sending | `render(body, vars)` in `core/templates.ts` |
| Rate-limit OTP and enroll routes | `strictLimiter` in `core/rateLimit.ts` (10 per 15 min per IP) |

All outbox templates and their default text: `DEFAULT_TEMPLATES` in `core/templates.ts`.
