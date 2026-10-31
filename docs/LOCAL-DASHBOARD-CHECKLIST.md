# Local dashboard checklist

## Done — ready to view locally

- [x] Admin dashboard remains a separate Vite app on `http://localhost:5173`.
- [x] Dummy participant dashboard runs separately on `http://localhost:5174`.
- [x] One command starts both dashboards: `corepack pnpm dev:dashboards`.
- [x] Participant demo is clearly marked as mock data and never claims to save production data.
- [x] Mobile-first sidebar/bottom navigation, responsive layouts and dark mode.
- [x] S3 home/status tracker, next action and announcements mock.
- [x] S4 eligibility state mock.
- [x] S5 team hub, readiness, matching and replacement toggle mock.
- [x] S6 JourneyLink, circle chat, arrival slots and room mock.
- [x] S7 offline ID card, backup code and check-in entry mock.
- [x] S8 schedule, announcements/problems navigation mock.
- [x] S9 mentor booking mock.
- [x] S10 progress, ticket, food pass and venue-map actions mock.
- [x] S11 submission, deadline, receipt and version-history mock.
- [x] S12 results, judge feedback and certificate action mock.
- [x] S13 RewardLink, complaints and Community Connect mock.
- [x] S14 profile, preferences, ID reissue and sign-out mock.
- [x] Interactive toast feedback for demo actions.

## Not done — needs your verification or production execution

- [ ] Start both dashboards and visually vet every participant navigation item.
- [ ] Start the backend on port 3000 when testing real API calls.
- [ ] S2 real WhatsApp OTP and email-link login UI integration.
- [ ] S2 real photo crop/compression and profile upload.
- [ ] S7 WebCrypto non-extractable device key, IndexedDB credential and real QR signing.
- [ ] S7 airplane-mode test with the admin scanner on real phones.
- [ ] S8 real Firestore listeners, seen receipts and push permission/delivery.
- [ ] S9 real booking/cancellation API integration and reminders.
- [ ] S10 real venue map and generated food-pass QR.
- [ ] S11 real Cloudinary upload progress and backend submission calls.
- [ ] S12 real certificate download/share and published leaderboard data.
- [ ] S13 real reward confirmation, evidence upload, ratings and connections.
- [ ] S15 loading/error/offline coverage, translation catalog and physical iOS/Android testing.
- [ ] S16 final visual consistency review with the admin portal.
- [ ] S17 Firebase Hosting deployment and installed-PWA/offline verification.
- [ ] Manthan M2 spare-SIM Baileys QR login and restart-without-rescan test.

## Commands

```bash
# Both dashboards only
corepack pnpm dev:dashboards

# Full stack: emulators, backend, admin and participant dashboard
corepack pnpm dev
```
