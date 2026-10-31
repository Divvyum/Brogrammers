# HACKOS API (admin side, Phase 1)

Base URL in dev: `http://localhost:3000` (the Vite apps proxy `/api` to it).
Request and response bodies are JSON. Dates go both ways as ISO strings. Request
schemas live in `packages/shared/src/api.ts` — use them for form validation so the
client and server agree.

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

Outbox templates queued so far: `eligibility_eligible`, `eligibility_flagged`,
`eligibility_rejected`, `team_locked`, `replacement_invite`, `waitlist_offer`,
`replacement_accepted`, `replacement_approved`, `enrollment_link`, `checkin_welcome`.
