# HACKOS data structure

**Status: frozen at the end of Phase 1.** Changing a collection, a field's meaning or
a document ID format now needs agreement from the whole team (plan decision 8).
Adding an optional field is fine; note it in the PR.

The source of truth for every document shape is
[`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts) (zod). This page is
the map: what lives where, who writes it, who can read it. Paths come from
`COL`, `eventPath()` and `DOC` in [`packages/shared/src/paths.ts`](../packages/shared/src/paths.ts).

**Who writes:** almost everything is written by the server (Admin SDK, bypasses rules).
Clients write directly only where marked **client**. Reads follow
[`firebase/firestore.rules`](../firebase/firestore.rules).

Roles: SA super admin, O organizer, V volunteer, M mentor, J judge, P participant.

## Top level

| Collection | Doc ID | Written by | Readable by | Notes |
|---|---|---|---|---|
| `users/{uid}` | Auth uid (imported participants: generated) | server | the user; O of the same event | Phone/email stored as AES-GCM `*Enc` + HMAC `*Hash`. Staff have `role`, `eventId`, `pinKey` (volunteers), `mentorTracks` (mentors). |
| `uniqueKeys/{type_hash}` | `phone_<hash>` / `email_<hash>` | server | nobody | Created in the same transaction as the user: one account per phone/email. |
| `outbox/{id}` | `${dedupeKey}_${uid}` | server (D), worker (M) | O, SA | `eventId`, `channel`, `to.uid`, `template`, `vars`, `priority` (0 = emergency), `status`. Deterministic IDs make retries safe. |
| `inbox/{id}` | message ID | worker | nobody | Incoming WhatsApp (Phase 2). |
| `waSession/{key}` | Baileys key | worker | nobody | Encrypted session (Phase 2). |
| `waStatus/current` | fixed | worker | O, SA | Connection health for the dashboard. |
| `templates/{id}` | template name | server (defaults), O via API | O, SA | `{{var}}` placeholders; defaults in `core/templates.ts`. |
| `certificates/{certId}` | 12-char code | server | nobody (public API instead) | Verified at `/api/public/certificates/:id`. |

## Per event: `events/{eventId}/…`

| Path | Doc ID | Written by | Readable by | Notes |
|---|---|---|---|---|
| *(event doc)* | auto | server | everyone in the event | `code` (scanner login), dates, team limits, `deadlines`, `rosterVersion`, `teamsLockedAt`, `submissionsLocked`, `meals`, `leaderboardVisible`. |
| `participants/{uid}` | user uid | server | O; the participant | `name`/`college` copied for filtering; `status` (plan 4.3); `eligibility{result,reason,override}`; `teamId`, `slotId`, `roomId`, `seat`; `enrollment{status,devicePubKey}`; `backupCode` (hash); `rosterVersion`; `checkedInAt`/`checkinId`; `mergedInto`; `withdrawnAt`. |
| `teams/{teamId}` | auto | server | O, M; assigned J; members | `memberUids`, `leaderUid`, `status` forming/locked. |
| `teamChangeRequests/{id}` | auto | server | O; the requester | join/leave/replace. |
| `duplicates/{a_b}` | sorted uid pair | server | O | Re-detection never recreates a dismissed pair. |
| `waitlist/{uid}` | user uid | server | O; the person | `position`, `status`, `offerExpiresAt`, `replacementId` (set when the replacement chain made the offer). |
| `replacements/{id}` | auto | server | O | `candidates`, `currentCandidate`, `inviteExpiresAt`, `passed`, `acceptedUid`. |
| `slots/{slotId}`, `rooms/{roomId}` | auto | server | everyone in the event | `booked`/`occupied` counters. |
| `enrollTokens/{sha256}` | hash of the token | server | nobody | Single use, 48 h. |
| `volunteerPins/{hmac}` | keyed hash of the PIN | server | nobody | Scanner login. |
| `checkins/{uuid}` | device UUID | **client** (V create-only), server | O; V own | Device fields are hash-chained and never changed; the server adds `processed`, `chain`, `flagged`, `serverResult`, `resolution`. |
| `stats/live` | fixed | server | O | Dashboard counters. |
| `schedule/{id}` | auto | server | everyone in the event | `audience{type,ids}`. |
| `problems/{id}` | auto | server | staff; participants once `released` | |
| `announcements/{id}` | auto | server | everyone in the event | `recipients`, `seenCount`. |
| `announcements/{id}/seen/{uid}` | user uid | **client** (P create-only) | O; the person | `{ seenAt: serverTimestamp }` only. |
| `mentorSlots/{mentorUid_startMs}` | deterministic | server | O; the mentor | `teamId`, `status`, `notes`. |
| `progress/{id}` | auto | server (Phase 2) | O, M | |
| `tickets/{id}` | auto | server | O, V | |
| `tasks/{id}` | auto | server | O; V own | `remindedAt` makes the reminder once-only. |
| `food/{uid_mealId}` | deterministic | server | O | Created, never overwritten: one claim per meal. |
| `travelPlans/{uid}`, `circles/{id}` | — | server (Phase 2) | O (+ participant rules in M19) | |
| `rubric/{round}` | `current` or round ID | server | O, J | Weights total 100; frozen once a score is locked. |
| `judgeAssignments/{judgeUid}` | judge uid | server | O; the judge | `teamIds`. |
| `submissions/{teamId}` (+ `versions/{n}`) | team ID | server | O; assigned J | `github` insights cache, `aiSummary`. |
| `scores/{judgeUid_teamId}` | deterministic | server | O; the judge | `round`, `criteria`, `total` (0–100), `locked`. |
| `leaderboard/current` | fixed | server | O, J; participants when visible | `teams[]`, `outlierJudges[]`, `consistency[]`. |
| `rewards/{id}` | auto | server | O | `status` pipeline, `history[]`, `overdue`, `proofUrl` (Cloudinary). |
| `complaints/{id}` | auto | server | O | `deadline`, `history[]`, `escalatedAt`. |
| `ratings/{uid}` | user uid | server | O | One per participant. |
| `connections/{id}` | auto | server (Phase 2) | O | |
| `audit/{id}` | auto | server, create-only | O | Every admin change: `actor`, `action`, `target`, `before`, `after`, `reason`. |

## Conventions

- **Dates:** Firestore Timestamps in documents; ISO strings over the API.
- **Deterministic IDs** wherever a duplicate would be a bug: outbox, food claims, scores, mentor slots, duplicate pairs.
- **Roster changes:** anything a scanner shows bumps `events/{id}.rosterVersion` and stamps the changed participants (`admin/digital-id/roster.ts`).
- **Crypto:** see `packages/shared/src/crypto` and Samrat's guide. Don't change it without Divyam and Samrat.
