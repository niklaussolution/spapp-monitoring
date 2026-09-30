# SPAPP Monitoring — Device Monitoring Application

Multi-tenant Android device monitoring app for parental control and employee transparency use cases.

See [docs/Device_Monitoring_App_Scope_Report.pdf](docs/Device_Monitoring_App_Scope_Report.pdf) for the full
feature scope and technical plan, and [docs/Implementation_Phase_Plan.pdf](docs/Implementation_Phase_Plan.pdf)
for the phase-by-phase build plan.

## Project Structure

```
SPAPP MONITORING/
├── android-app/   # Kotlin Android app (Room, WorkManager, FCM)
├── backend/       # Node.js + Express API + PostgreSQL
├── dashboard/     # React admin dashboard
└── docs/          # Scope report, phase plan, schema docs, API specs
```

## Status

- [x] Phase 1: Foundation setup (folder structure, backend skeleton)
- [x] Phase 2: Database schema & backend core
- [x] Phase 3: Android app core skeleton
- [x] Phase 4: Data collection modules
- [x] Phase 5: Location & geofencing
- [x] Phase 6: Remote actions
- [x] Phase 7: App/website blocking
- [x] Phase 8: Admin dashboard
- [ ] Phase 9: Integration & testing
- [ ] Phase 10: Deployment

## Data Storage Architecture

Two datastores, split by data type:

- **Firestore** (`backend/src/services/firestore.service.js`) — admin accounts only:
  `tenants` and `users` collections. Passwords are bcrypt-hashed before being written;
  Firestore never stores a plaintext password. Requires
  `backend/firebase-service-account.json` (gitignored — Firebase Console → Project
  Settings → Service Accounts → Generate new private key) and a Firestore database
  created in **Native mode** for the project. Without this file, register/login fail
  outright (`503`) — unlike FCM push, there's no silent fallback for auth data.
- **PostgreSQL** (`backend/src/db/schema.sql`) — everything else: devices, feature
  flags, location/geofence data, app usage, SMS/call logs, installed apps, block
  rules, alerts, remote commands. `devices.tenant_id` is a UUID matching a Firestore
  `tenants/{id}` document, with no Postgres-level foreign key (Firestore is the
  source of truth for tenant existence) — ownership checks compare it as a plain
  string against the JWT's `tenantId` claim.

## Backend Setup (local dev)

```bash
cd backend
npm install
cp .env.example .env          # fill in DB credentials, JWT secret, etc.
docker-compose up -d          # starts local PostgreSQL on port 5433
npm run migrate               # applies src/db/schema.sql
# Place firebase-service-account.json in backend/ (see "Data Storage Architecture")
npm run dev
```

## Database Schema (Phase 2)

14 tables — see [backend/src/db/schema.sql](backend/src/db/schema.sql):
`tenants`, `users`, `devices`, `feature_flags`, `location_logs`, `geofences`,
`app_usage_logs`, `web_history_logs`, `sms_logs`, `call_logs`, `installed_apps`,
`block_rules`, `alerts`, `remote_commands`. All monitoring data tables link back
to `devices.tenant_id` for multi-tenant row isolation.

## API Endpoints (Phase 2)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Create a new tenant + owner user |
| POST | `/api/auth/login` | Public | Admin login, returns JWT |
| GET | `/api/tenants/me` | Admin JWT | Get own tenant info |
| GET | `/api/tenants/me/users` | Admin JWT | List own tenant's admin users |
| POST | `/api/devices` | Admin JWT | Create device placeholder, returns install token |
| GET | `/api/devices` | Admin JWT | List own tenant's devices |
| GET | `/api/devices/:id` | Admin JWT | Device detail + feature flags |
| PATCH | `/api/devices/:id/feature-flags` | Admin JWT | Toggle agreed-scope features per device |
| POST | `/api/devices/activate` | Device token | Android app activates itself after consent |

**Tested (2026-09-30):** register, login (correct + wrong password), device create/list/detail,
feature-flag update, device activation via token, invalid-token rejection, duplicate-email
rejection, and multi-tenant isolation (a second tenant cannot list, read, or modify the first
tenant's devices — verified 404 on cross-tenant access).

## Android App (Phase 3)

Kotlin, single dynamic APK — feature scope is controlled entirely by the backend's
`feature_flags` table (Phase 2) and toggled from the dashboard; no per-tenant or
per-device build variants.

**Flow implemented:** `SplashActivity` (routes by local state) → `ConsentActivity`
(mandatory, matches the scope report's consent text) → runtime permission requests →
`ActivationActivity` (exchanges the admin-issued device code for a device auth token via
`POST /api/devices/activate`) → `MainActivity` (status screen). Local offline buffer
(`AppDatabase` / Room) is scaffolded for Phase 4's data-collection modules.

**Tested (2026-09-30), Android 15 emulator (Pixel_7, API 34), against the local backend:**
project builds (`assembleDebug` — BUILD SUCCESSFUL), unit tests pass
(`testDebugUnitTest`), APK installs with the app icon visible in the launcher (no hidden
icon), consent screen renders the agreed text, native permission dialogs trigger
correctly, device activation completes end-to-end and is confirmed in the backend
(`status: active`, `consent_given_at` set, real `os_version` reported). Debug builds use
a `src/debug`-scoped network security config to allow cleartext HTTP to the local dev
backend only; release builds keep Android's default (HTTPS-only) behavior.

## Data Collection Modules (Phase 4)

Four collectors, each gated by its backend feature flag and run from `SyncWorker`
(periodic, every 3 hours via WorkManager — no foreground service, no persistent
notification):

| Collector | Source | Notes |
|---|---|---|
| `AppUsageCollector` | `UsageStatsManager` | Requires the "Usage Access" special grant (Settings, not a runtime dialog) — `MainActivity` prompts for it when missing |
| `SmsLogCollector` | SMS content provider | Metadata only (number, direction, timestamp) — never message body |
| `CallLogCollector` | Call log content provider | Metadata only (number, direction, duration, timestamp) — never audio |
| `InstalledAppsCollector` | `PackageManager` | Point-in-time snapshot, re-sent and upserted in full each run |
| `WebHistoryCollector` | Legacy browser content provider | **Known limitation**: modern Chrome exposes no history provider to third-party apps; returns empty on Chrome-only devices. Documented as best-effort in code. |

Backend: `POST /api/sync/{app-usage,sms-log,call-log,installed-apps}` (device-token
auth, feature-flag-checked server-side too) and `GET /api/sync/feature-flags`.
Admin read endpoints: `GET /api/devices/:id/{app-usage,sms-log,call-log,installed-apps}`.

**Tested (2026-09-30), Android 15 emulator, real content providers (adb-seeded call
log + real on-device app usage + real installed-app inventory):** full sync cycle
runs end-to-end and lands correctly in Postgres. One real bug found and fixed during
testing — `CallLogCollector`/`SmsLogCollector`/`WebHistoryCollector` used a `LIMIT`
token in the content-provider `sortOrder` string, which some providers (including the
emulator's) reject with `IllegalArgumentException`; fixed by capping in-memory instead.
A second issue was found and fixed: app usage is a daily *cumulative total*, not a
delta, so naive inserts produced duplicate rows across sync runs — both the local
Room buffer and the backend (`app_usage_logs` now has a `UNIQUE (device_id,
package_name, usage_date)` constraint with `ON CONFLICT DO UPDATE`) were changed to
upsert instead of insert. Verified idempotent: two consecutive "Sync Now" runs produce
zero duplicate `(package, date)` rows.

## Location & Geofencing (Phase 5)

**On-demand location** — admin queues a command (`POST /api/devices/:id/commands`,
`commandType: "location_check"`); the device's `SyncWorker` picks it up on its next
poll (`GET /api/sync/commands`), fetches a fix via `LocationFetcher`, and reports it
(`POST /api/sync/location`), which acks the command and appends to `location_logs`.
Phase 5 delivery is poll-based (piggybacked on the existing periodic sync — no new
background service or notification); Phase 6 adds FCM push so this becomes instant
instead of waiting for the next poll.

**Geofencing** — admin defines a boundary (`POST /api/devices/:id/geofences`); the
device fetches active geofences each sync and registers them with Android's native
`GeofencingClient` (`GeofenceManager`) — OS-level monitoring, no polling, no
notification. A transition is caught by `GeofenceBroadcastReceiver` (fired by the OS,
not our app) and reported via a `GeofenceEventWorker`, which records a location point
and raises an alert (`alerts` table, `GET /api/devices/:id/alerts`).

Admin dashboard-facing reads: `GET /api/devices/:id/location-history`,
`GET /api/devices/:id/commands`, `GET /api/devices/:id/geofences`,
`GET /api/devices/:id/alerts`.

**Tested (2026-09-30), Android 15 emulator with `adb emu geo fix`:** full on-demand
location cycle verified end-to-end (command queued → polled → location fetched →
reported → command `status: acked`, real coordinates in `location_logs`).

Two real bugs found and fixed during testing:
1. **`getCurrentLocation()` returning a null `Location` on success** (common right
   after boot or on an emulator/device whose location provider isn't "warmed up") was
   being treated as "no fix available," silently dropping the command with no retry.
   Fixed by falling back to `getLastLocation()` (the cached last-known fix) when the
   fresh fetch comes back null.
2. **A command that failed to get a location stayed `sent` forever**, with no retry
   path — the dashboard's request would hang indefinitely. Fixed: `GET
   /api/sync/commands` now also re-delivers any command still stuck at `sent` after
   10+ minutes.

**Known emulator-only limitation (not a code bug):** `GeofencingClient.addGeofences()`
consistently fails with `"registration not permitted"` on this AVD — a widely-reported
Google Play services limitation on emulators (real devices are unaffected). Confirmed
our code handles this gracefully: the failure is caught, logged, and does not crash
`SyncWorker` (`Worker result SUCCESS` even when geofence registration fails). Full
geofence ENTER/EXIT verification needs a real device or a physical-location-capable
test rig — flagged for Phase 9 (Integration & Testing) rather than blocking here.

## Remote Actions (Phase 6)

**FCM push** — `backend/src/services/fcm.service.js` lazily loads
`backend/firebase-service-account.json` (gitignored) via firebase-admin. Every time an
admin queues a command, the backend sends a silent data-only push (`{"type":"sync"}`,
never command details) to wake the device instantly. If the service account file is
missing, or the push fails, or the device is offline, delivery **silently falls back**
to Phase 5's poll (device picks the command up on its next sync) — the command queue
in Postgres is the single source of truth either way, so nothing is ever lost.
`android-app/app/google-services.json` (package `com.spapp.monitoring`) wires the
Android side; `SpappFirebaseMessagingService` receives the nudge and triggers an
immediate sync pass.

**Remote Lock** — `SpappDeviceAdminReceiver` (Device Admin API, `force-lock` policy
only — no password, wipe, or camera restrictions requested). Activation requires an
explicit system dialog the user must accept ("Enable Remote Lock" button on
`MainActivity`); never silent. `SyncWorker` calls `DevicePolicyManager.lockNow()` on a
pending `lock` command and acks via the new generic `POST /api/sync/commands/:id/ack`.

**File Manager** — `FileManagerCollector` lists/reads files in the app's own private
internal storage (`context.filesDir`) only. **Scope limitation, by design, not an
oversight**: Android's scoped storage (10+) blocks third-party apps from browsing
arbitrary device storage without `MANAGE_EXTERNAL_STORAGE`, a Play-Store-gated special
permission we deliberately do not request.

**File Download** — no server storage, ever. `backend/src/ws/fileRelay.js` is a raw
WebSocket relay (`/ws/file-transfer`, JWT-authed per role): the admin dashboard
connects first and waits; the device, on picking up a `file_download` command, opens
its own WebSocket, sends one JSON header frame (filename/size/mime), streams the file
as binary frames, then closes — the server does nothing but forward bytes between the
two sockets for a given `commandId`. `FileTransferClient` (Android, OkHttp WebSocket)
is the device-side implementation.

Admin-facing: `GET /api/devices/:id/commands/:commandId` polls a single command's
status + result (e.g. for `file_list`'s file array, once `status` becomes `acked`).

**Tested (2026-09-30), Android 15 emulator, real backend + real WebSocket relay (no
mocks):**
- Remote Lock: command queued → device admin dialog accepted (screenshot-verified,
  showed exactly the "Lock the screen" policy, nothing more) → `lockNow()` called →
  emulator's `mWakefulness` confirmed `Asleep` → command `status: acked`.
- File Manager: real files (including an adb-seeded test file) listed correctly with
  name/size/mimeType.
- File Download: a real WebSocket test client (simulating the admin dashboard)
  connected first, the device streamed the file live, and the received bytes matched
  the source file exactly — proving the "no server storage" relay design end-to-end.
- FCM graceful fallback: confirmed `push: {sent: false, reason: "fcm_unavailable"}`
  when no service account key is present, and the poll-based path still completes
  every command correctly.

One real bug found and fixed: `FileManagerCollector`'s relative-path computation used
`context.filesDir` (which can return a path through a `/data/user/0/...` symlink)
together with `File.canonicalFile` (which resolves to the real `/data/data/...` path)
inconsistently, producing garbled paths like `../../../../data/com.spapp.monitoring/
files/test_report.txt` instead of `test_report.txt`. Fixed by canonicalizing the root
once and reusing that same reference for both the path-traversal safety check and the
`relativeTo()` calculation.

## App/Website Blocking (Phase 7)

`BlockAccessibilityService` (Android Accessibility Service) enforces block rules —
activation requires the user to manually flip it on in system Accessibility settings
(Android does not allow silently granting this; "Enable App/Website Blocking" on
`MainActivity` links there). It only inspects two things: which app's window just came
to the foreground, and, for a handful of known browsers, the visible address-bar text
— never message content or other on-screen text (stated explicitly in the service's
own system-shown description).

Rules (`block_rules` table, already in the Phase 2 schema) support an optional
schedule (`{days, start, end}`); no schedule = always active. Admin CRUD:
`POST/GET/PATCH/DELETE /api/devices/:id/block-rules`. The device fetches active rules
each sync (`GET /api/sync/block-rules`, gated by the `app_blocking` flag — returns `[]`
when disabled, which is cached too, so blocking stops immediately if the admin turns
the flag off) and caches them locally (`BlockRulesCache`) so every foreground-app
change can be checked instantly, with no network round-trip. A block redirects to Home
and reports a `block_violation` alert.

**Website blocking limitation (documented, not an oversight)**: only works for
browsers whose URL bar exposes a stable accessibility resource-id (Chrome, Firefox,
Brave, Edge are included); an unsupported/updated browser simply can't be
domain-blocked, while app-level blocking (blocking the browser entirely) still works
regardless — same honesty pattern as `WebHistoryCollector`'s limitation in Phase 4.

**Tested (2026-09-30), Android 15 emulator, real Accessibility Service (no mocks):**
service enable flow screenshot-verified end-to-end, including Android's own system
warning dialog and our service's description text rendering correctly in Settings.
Created a rule blocking Chrome; opening Chrome was confirmed redirected to the
launcher (`mCurrentFocus` = `NexusLauncherActivity`, not Chrome) and a `block_violation`
alert was recorded in the backend with the correct rule ID and target. Deactivated the
rule, re-synced, and confirmed Chrome then opened normally (`mCurrentFocus` = Chrome's
own activity) — verifying both the block and unblock paths.

## Admin Dashboard (Phase 8)

React + TypeScript + Vite, Tailwind CSS, React Router, Recharts, Axios.

**Pages**: `/login`, `/register`, `/devices` (list + "Add Device" → shows the one-time
install code), `/devices/:id` (full detail — feature-flag toggles, remote actions,
location history, geofences CRUD, app usage chart, installed apps, block rules CRUD,
alerts, call/SMS log tables).

**Remote actions from the UI**: "Check Location Now" / "Lock Device" / "List Files"
queue a command and poll `GET /api/devices/:id/commands/:commandId` every 2s (up to
30s) until it's `acked`, showing live status text — the same command-queue mechanism
built in Phase 5/6, now driven by clicks instead of curl.

## Local Dev Setup

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5173, proxies to backend at :4000 (see .env)
```

**Tested (2026-09-30), real browser (not a mock), full stack running together**
(Postgres + backend + dashboard + Android emulator): TypeScript compiles clean
(`tsc -b`, zero errors) and the production build succeeds. End-to-end through the
actual UI, driving real React state (not just API calls):
- Register → redirected to `/devices` → "Add Device" → install code shown → entered on
  the emulator's activation screen → device correctly appears `active` with its real
  `Android 15` OS version and `last_seen_at` timestamp — no manual curl involved.
- Clicked "Check Location Now": command queued, UI showed "waiting for device...",
  emulator's periodic sync picked it up, reported a real GPS fix, and the dashboard's
  Location History updated with the actual coordinates on reload — the full Phase 5
  command pipeline verified through clicks alone.
- Toggled the `app_blocking` feature-flag checkbox → confirmed persisted correctly in
  Postgres.
- Created a block rule (`app`, `com.android.chrome`) through the UI form → correctly
  listed with Active/Remove controls — same `block_rules` flow Phase 7 verified via
  curl, now reachable by a real admin through the browser.
