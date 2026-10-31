# Manthan implementation checklist

- [x] M1 participant middleware and `/api/p` foundation
- [x] M2 QR login, encrypted Firestore auth state, batched keys, reconnect/backoff, status
- [x] M3 transactional outbox, retries, stale-lock recovery, throttling, email/push
- [x] M4 inbox and seven commands with sender lookup and rate limiting
- [x] M5 WhatsApp OTP/custom token; email-link fallback remains client-side by design
- [x] M6 profile registration, unique email/phone ownership, eligibility and confirmation
- [x] M7 team create/join/leave/withdraw and change requests
- [x] M8 ranked matching and connections
- [x] M9 replacement and waitlist responses
- [x] M10 travel circles, messages and transactional slot capacity
- [x] M11 token enrollment and reissue wired to the shared signer
- [x] M12 single status endpoint and step updates
- [x] M13 participant content, seen receipts and FCM token/topics
- [x] M14 transactional mentor booking/cancel/reminders
- [x] M15 progress, tickets, reminders and food pass
- [x] M16 signed uploads, URL/deadline/version/receipt/GitHub processing
- [x] M17 leaderboard, scores and certificates
- [x] M18 rewards, complaints, ratings and community connections
- [x] M19 participant Firestore access rules
- [x] M20 emulator-only 300-participant load generator and quota record
- [x] M21 participant route and Baileys login documentation

## Real-device acceptance checks

- [ ] Scan with the team's spare SIM and verify restart without rescanning.
- [ ] Verify an actual FCM push on a subscribed phone.
- [ ] Enroll a real phone and scan it in airplane mode.
- [ ] Run the full staged participant flow with Cloudinary/Firebase credentials.

These require team-owned credentials/hardware and cannot be truthfully marked by
an automated local test.
