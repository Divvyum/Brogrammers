# Participant API (`/api/p`) — request and response examples

For the student app (plan M21). Base URL in dev: `http://localhost:3000/api/p`
(the Vite app proxies `/api`). Dates are ISO strings. Errors look like
`{ "error": "CONFLICT", "message": "Slot is full" }` (see `docs/API.md`).

**Auth.** Everything except the *Public* section needs
`Authorization: Bearer <Firebase ID token>` for an account with the claim
`{ role: "participant", eventId }`. The event always comes from the claim.

---

## Public

| Route | Request | Response |
|---|---|---|
| `GET /public/event?code=HACK26` | — | `{ "id": "evt1", "name": "HACKOS Demo Hackathon 2026", "code": "HACK26", "mode": "offline", "startAt": "…", "endAt": "…", "tracks": ["AI", "FinTech"] }` |
| `POST /auth/otp/request` (10 per 15 min) | `{ "phone": "9820000000", "eventId": "evt1" }` | `202 { "sent": true }` — code goes out on WhatsApp. Local emulators with `DEV_OTP=true` also return `"devCode": "123456"`. |
| `POST /auth/otp/verify` | `{ "phone": "9820000000", "eventId": "evt1", "code": "123456" }` | `{ "token": "<custom token>", "uid": "p001" }` → `signInWithCustomToken(auth, token)`. 5 attempts, 5-minute expiry. |
| `POST /auth/email/claim` (header: email-link session's ID token) | `{ "eventId": "evt1" }` | `{ "token": "<custom token>", "uid": "p001", "existing": true }`. Sign in with the token: it's the participant account for that email (or this new account, now a participant). |
| `POST /enroll` | `{ "eventId": "evt1", "token": "<from the enrollment link>", "devicePubKey": "<base64url, 65 bytes>" }` | `{ "credential": { "payload": {…}, "sig": "…" }, "backupCode": "GE9WRVN2", "organizerPubKey": "…", "uid": "p001", "profile": { "name": "…", "college": "…", "teamId": "…" } }` |

## Profile and registration

| Route | Request | Response |
|---|---|---|
| `GET /me` | — | `{ "uid": "p001", "profile": { "name": "…", "college": "…", "skills": […], "photoUrl": "…" }, "registration": { "status": "eligible", "eligibility": {…}, "teamId": "…", … } }` |
| `GET /status` | — | `{ "status": "room_assigned", "eligibility": { "result": "eligible", "reason": "All checks passed" }, "teamId": "team01", "slotId": "slot1", "roomId": "r1", "seat": "A101-3", "checkedInAt": null }` |
| `GET /event` | — | `{ "id", "name", "code", "mode", "startAt", "endAt", "teamMin", "teamMax", "tracks", "rounds", "deadlines": { "teamLock", "submission" }, "teamsLocked", "submissionsLocked", "leaderboardVisible", "resultsPublishedAt", "meals": [{ "id", "name", "startAt", "endAt" }], "eligibilityRules", "content": { "venue", "tagline", "rulesUrl", "helpPhone", "whatsappNumber", "rules", "prizes", "alumni", "map": { "imageUrl", "markers": [{ "layer", "label", "x", "y" }] } } }` (content is edited in the admin app) |
| `PUT /registration` | `{ "name": "Asha Rao", "email": "asha@x.in", "college": "SAKEC", "year": 2, "city": "Mumbai", "skills": ["react"], "track": "AI", "githubUsername": "asharao", "photoUrl": "https://res.cloudinary.com/…" }` | `201 { "registered": true }` — runs eligibility and duplicate checks, sends a WhatsApp confirmation. |
| `PUT /profile` (any subset) | `{ "city": "Pune", "skills": ["react", "ml"], "notifications": { "announcements_WhatsApp": false } }` | `{ "saved": true }`. Notification keys are `<category>_<WhatsApp\|Push\|Email>` for categories `team`, `schedule`, `announcements`, `results`; a missing key means on. The outbox skips muted messages (status `skipped`); sign-in codes, receipts, command replies and emergencies always go. |
| `POST /registration/recheck` | `{ "reason": "My college is a partner college" }` | `201 { "id": "<ticket id>" }` |
| `POST /upload-signature` | `{ "folder": "photos" \| "submissions" \| "complaint-evidence" }` | `{ "uploadUrl", "apiKey", "timestamp", "folder", "allowed_formats", "signature", "maxBytes" }` — POST the file to `uploadUrl` as form data with these fields. |

## Team, matching, replacement

| Route | Request | Response |
|---|---|---|
| `GET /team` | — | `{ "team": { "id", "name", "inviteCode", "status", "track", "leaderUid", "members": [{ "uid", "name", "college", "skills", "photoUrl", "isLeader", "isMe" }] } \| null, "requests": [], "invitations": [], "openToReplacement": { "on", "skills", "availability" } \| null }` |
| `GET /teams/mine` | — | the team document, or `null` |
| `POST /teams` | `{ "name": "Ctrl Alt Elite", "track": "AI" }` | `201 { "id", "name", "inviteCode": "K3J9ZQ2A", … }` |
| `POST /teams/join` | `{ "inviteCode": "K3J9ZQ2A" }` | `{ "teamId": "team01" }` (respects size limit and lock) |
| `POST /teams/leave` | `{}` | `204` |
| `DELETE /teams/:teamId/members/:uid` (leader, before lock) | — | `204` |
| `POST /teams/withdraw` (after lock) | `{ "reason": "Exam clash" }` | `{ "replacementId": "…" }` — the replacement chain starts |
| `POST /team-requests` | `{ "type": "join" \| "leave" \| "replace", "teamId": "team01", "reason": "…" }` | `201 { "id" }` |
| `POST /teams/:teamId/invitations` (leader) | `{ "toUid": "p042" }` | `201 { "id" }` — WhatsApp invite |
| `POST /invitations/:id/accept` · `/decline` | `{}` | `{ "ok": true }` — accepting joins the team (size and lock rules apply) |
| `GET /matching` | — | `{ "suggestions": [{ "uid", "name", "skills", "score" }] }` |
| `PUT /replacement/open` | `{ "on": true, "skills": ["ml"], "availability": "Full event" }` | the same object |
| `GET /offers` | — | `{ "replacements": [{ "id", "status": "invited", "teamId", "teamName", "track", "expiresAt" }], "waitlist": { "position", "status": "offered", "offerExpiresAt" } \| null }` |
| `POST /replacements/:id/accept` · `/decline` | `{}` | `{ "accepted": true }` · `{ "declined": true }` |
| `POST /waitlist/respond` | `{ "accept": true }` | `{ "ok": true }` |

## JourneyLink

| Route | Request | Response |
|---|---|---|
| `GET /slots` | — | `[{ "id": "slot1", "startAt", "endAt", "capacity": 40, "booked": 35 }]` |
| `POST /slots/:slotId/book` (also to change slot) | `{}` | `{ "slotId", "room": { "roomId", "seat" } \| null }` — 409 if full |
| `GET /room` | — | `{ "id", "name": "A101", "floor": "1", "track", "mentorDesk", "seat": "A101-3" }` or `null` |
| `GET /travel` | — | the saved plan or `null` |
| `PUT /travel` | `{ "city": "Thane", "route": "Thane → venue", "mode": "train", "departAt": "…", "arriveAt": "…", "carpool": false }` | `{ "circleId": "mumbai_train_123" \| null }` — matching groups nearby cities, same mode, arrivals within 4 h |
| `GET /circles` (with names) · `GET /circles/mine` | — | `[{ "id", "route", "city", "mode", "members", "memberDetails": [{ "uid", "name" }], "meetupPoint", "carpool" }]` |
| `POST /circles/rematch` | `{}` | `{ "groups": 4 }` |
| `GET /circles/:id/messages` | — | `[{ "id", "uid", "name", "text", "createdAt", "mine" }]` (oldest first) |
| `POST /circles/:id/messages` | `{ "text": "Meet at platform 2?" }` | `201 { "id" }` |
| `PATCH /circles/:id` | `{ "meetupPoint": "Thane station, platform 2" }` | `{ "meetupPoint" }` |
| `POST /circles/:id/leave` | `{}` | `204` |

## Digital ID

| Route | Request | Response |
|---|---|---|
| `POST /id/enroll` (signed in) | `{ "devicePubKey": "<base64url>" }` | `{ "credential", "backupCode", "organizerPubKey" }` |
| `POST /id/reissue` | `{ "reason": "Changed phone" }` | `{ "reissued": true }` — a new link is sent; the old phone stops working |

## Event content

| Route | Request | Response |
|---|---|---|
| `GET /schedule` | — | `[{ "id", "title", "startAt", "endAt", "location", "audience" }]` (only items for me) |
| `GET /problems` | — | released problems for my track: `[{ "id", "track", "title", "body", "releaseAt" }]` |
| `GET /feed` | — | `[{ "id", "title", "body", "emergency", "createdAt", "seen" }]` (announcements for me) |
| `GET /announcements` | — | all announcements |
| `POST /announcements/:id/seen` | `{}` | `204` |
| `PUT /fcm-token` | `{ "token": "<FCM token>", "topics": ["track_AI", "room_r1"] }` | `{ "registered": true, "topics": ["all", …] }` |

## Mentors and event day

| Route | Request | Response |
|---|---|---|
| `GET /mentors` | — | `{ "mentors": [{ "uid", "name", "tracks", "openSlots": [{ "id", "startAt", "endAt" }] }], "bookings": [{ "id", "mentorName", "startAt", "topic", "bookedBy" }] }` |
| `GET /mentor-slots` | — | open slots |
| `POST /mentor-slots/:id/book` | `{ "topic": "Database design" }` | `{ "booked": true }` — one team per slot, max 3 per team |
| `DELETE /mentor-slots/:id/book` | — | `204` (only the person who booked) |
| `GET /progress` · `POST /progress` | `{ "text": "Login works" }` | list · `201 { "id" }` |
| `GET /tickets` · `POST /tickets` | `{ "text": "Wi-Fi down in B102", "roomId": "r3" }` | my tickets · `201 { "id" }` |
| `GET /meals` | — | `[{ "id", "name", "startAt", "endAt", "claimedAt", "counter" }]` (my claim per meal) |
| `GET /food-pass` | — | `{ "token": "<signed>", "expiresInSeconds": 900 }` — show `token` as a QR |

## Submission and results

| Route | Request | Response |
|---|---|---|
| `GET /submission` | — | `{ "deadline", "locked", "teamId", "current": { "pptUrl", "videoUrl", "repoUrl", "version", "receiptId", "submittedAt" } \| null, "versions": [{ "version", "receiptId", "submittedAt" }] }` |
| `POST /submissions` | `{ "pptUrl": "https://res.cloudinary.com/…", "videoUrl": "https://youtu.be/…", "repoUrl": "https://github.com/team/project" }` | `201 { "receiptId", "version" }` — 409 after the deadline (server time) |
| `GET /results` | — | `{ "leaderboard": { "teams": [{ "rank", "teamName", "total", "breakdown" }] }, "myScores": [{ "criteria", "total", "comment" }] }` — 403 until published |
| `GET /certificates` | — | `[{ "id", "type", "rank", "downloadUrl": "/api/public/certificates/<id>/pdf" }]` |

## After the event

| Route | Request | Response |
|---|---|---|
| `GET /rewards` | — | my team's rewards with `status` and `history` |
| `POST /rewards/:id/confirm` (delivered only) | `{}` | `{ "confirmed": true }` |
| `GET /complaints` · `POST /complaints` | `{ "rewardId": "reward_1", "text": "Not received", "evidenceUrls": ["https://res.cloudinary.com/…"] }` | mine · `201 { "id" }` (3-day deadline, then escalates) |
| `POST /complaints/:id/reply` · `/resolve` | `{ "note": "Still waiting" }` · `{}` | `{ "ok": true }` |
| `GET /rating` · `POST /ratings` | `{ "scores": { "organization": 5, "mentors": 4, "judging": 4, "comms": 5, "infra": 3, "rewards": 4 }, "text": "Great" }` | `{ "canRate", "rating" }` · `201` (checked-in people, after the event, once) |
| `GET /connections` | — | `[{ "id", "status", "incoming", "other": { "uid", "name" } }]` |
| `POST /connections` · `/connections/:id/respond` | `{ "toUid": "p042" }` · `{ "accept": true }` | `201 { "id" }` · `{ "status" }` |
| `GET /community` · `PUT /community/opt-in` | — · `{ "enabled": true }` | directory · `{ "enabled" }` |
