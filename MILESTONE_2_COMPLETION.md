# Milestone 2 — Completion Report
**Bailey & Beau Interactive Family Reading & Activity Platform**

| | |
|---|---|
| **Milestone** | M2 — Reading Room |
| **Status** | ✅ Complete |
| **Completed** | 17 April 2026 |
| **BA Reference** | BA Version 1.0, Section 05 (FR-01), Section 11 (Acceptance Criteria) |
| **Staging Server** | `http://16.16.146.231` |
| **Repository** | https://github.com/Ezzatullah1016/bailyandbeau |

---

## Scope Delivered

Per the BA report, M2 covers: **Video session, Book Viewer, Shared Annotation, Session Timer, Host Controls.**

All five functional requirements (FR-01.1 through FR-01.5) are implemented and verified in code.

---

## Acceptance Criteria Verification

| # | Criterion (from BA §11) | Status | Implementation |
|---|---|---|---|
| AC-01 | Two participants join via invite link → live video + audio call | ✅ Pass | `LiveKitRoom` + `InviteJoinView` + lobby handshake |
| AC-02 | Host navigates pages; participant view syncs in real time | ✅ Pass | `PAGE_TURN` data channel message, `reliable: true` |
| AC-03 | Both draw on shared annotation canvas; strokes sync within 200ms | ✅ Pass | Fabric.js + `CANVAS_SYNC` data channel, debounce ≤200ms |
| AC-04 | 20-min timer visible and synced; warnings at 5 min and 2 min | ✅ Pass | `TIMER_START` broadcast with epoch timestamp |
| AC-05 | Only host has page turn controls; guest view hides navigation | ✅ Pass | Conditional `{role === 'host' && ...}` render guard |

---

## Functional Requirements Delivered

### FR-01.1 — Video Session
- LiveKit WebRTC room initiated on session creation
- Host and guest tokens issued by Django (`build_realtime_token()`) with `can_publish`, `can_subscribe`, `can_publish_data` grants
- Mute, camera toggle, and participant list available in-room
- Reconnection banner displayed during `ConnectionState.Reconnecting`

### FR-01.2 — Book Viewer
- Book pages fetched from S3 via `/api/v1/books/<id>/pages/` and rendered as images
- Host controls page navigation (forward/back chevrons)
- Guest view is read-only; page synced within one data channel round-trip
- Page counter visible to both participants ("Page X of Y")

### FR-01.3 — Shared Annotation
- Fabric.js canvas overlaid directly on the current book page
- Both participants can draw; strokes serialised and broadcast via `CANVAS_SYNC`
- Pen, eraser, colour picker, and brush size controls in toolbar
- Canvas clears on every page turn (local + broadcast `CANVAS_CLEAR`)
- Debounce logic: payloads < 50 KB sync immediately; ≥ 50 KB debounced to 200ms

### FR-01.4 — Session Timer
- 20-minute (`SESSION_DURATION_S = 1200`) countdown timer
- Host starts timer via `TIMER_START` broadcast (contains epoch `started_at`)
- Both participants count down locally from the same epoch — stays in sync
- `TimerWarning` component activates at ≤ 300s (5 min) — amber pulse
- Escalates to red at ≤ 120s (2 min)
- Session auto-ends at 0 via `handleEndSession(true)` (host only)

### FR-01.5 — Host Controls
- Host role is determined from `SessionContext` (set at lobby/invite join time)
- Page turn buttons (`chevron_left`, `chevron_right`) only render for `role === 'host'`
- Host-only controls: page navigation, timer start, session end, activity handoff
- Host role badge displayed in participant list
- Host can transfer role mid-session via `TransferHostView` (`/sessions/<id>/transfer-host/`)

---

## Additional Features Delivered (Beyond M2 Core)

| Feature | Detail |
|---|---|
| Pre-session lobby | Camera/mic check with live preview; `PARTICIPANT_READY` handshake before session start |
| Auto-reconnection | `getSnapshot()` restores page position and timer state on rejoin |
| Session snapshots | `updateSnapshot()` persists page, timer, and canvas state on each turn |
| Session completion flow | Badge reveal overlay with animated display on session end |
| Host delegation | `transfer-host` API endpoint; host role transferable mid-session |
| Connection state banner | Live `ConnectionState` indicator (Connecting / Reconnecting / Disconnected) |

---

## 1. Live URLs — Staging Server (Backend)

The backend runs on `http://16.16.146.231`. All API endpoints are prefixed `/api/v1/`.

### Admin & Portal

| URL | What It Is | Credentials |
|---|---|---|
| `http://16.16.146.231/` | Public home page | — |
| `http://16.16.146.231/login/` | Auth portal (login / register) | **`client-review` / `BaileyBeauReview2026!`** (provision with `python manage.py seed_client_review_user` on the server) |
| `http://16.16.146.231/admin/` | Django admin panel | `admin` / `admin1234` |
| `http://16.16.146.231/super-admin/dashboard/` | Custom super-admin dashboard | Login first |
| `http://16.16.146.231/super-admin/sessions/` | Session monitor | Login first |
| `http://16.16.146.231/super-admin/books/` | Book library | Login first |

**Provisioning `http://16.16.146.231/login/` for QA:** SSH into the host, `cd` to the Django project, activate the app venv, then run `python manage.py seed_client_review_user`. That creates or resets **`client-review`** with password **`BaileyBeauReview2026!`**. Rotate or disable this account in Django admin when testing finishes.

### REST API — Session & Reading Room Endpoints

| Method | URL | What It Tests |
|---|---|---|
| `GET` | `/api/v1/health/` | Server health |
| `POST` | `/api/v1/auth/register/` | Create test user |
| `POST` | `/api/v1/auth/login/` | Get JWT token |
| `POST` | `/api/v1/sessions/` | Create a session (returns invite_token) |
| `GET` | `/api/v1/sessions/<id>/` | Session detail |
| `GET` | `/api/v1/sessions/<id>/invite/` | Invite link detail |
| `POST` | `/api/v1/invites/<token>/join/` | Guest joins session (returns realtime_token) |
| `POST` | `/api/v1/sessions/<id>/ready/` | Mark participant ready |
| `POST` | `/api/v1/sessions/<id>/start/` | Start session (host only) |
| `GET` | `/api/v1/sessions/<id>/snapshot/` | Get current page + timer state |
| `PUT` | `/api/v1/sessions/<id>/snapshot/` | Update snapshot (page turn) |
| `POST` | `/api/v1/sessions/<id>/complete/` | Complete session + award badges |
| `POST` | `/api/v1/sessions/<id>/transfer-host/` | Transfer host role |
| `GET` | `/api/v1/books/` | List published books |
| `GET` | `/api/v1/books/<id>/pages/` | Fetch book pages (images) for viewer |

---

## 2. End-to-End Test Flow (Manual QA)

Use two browser windows (or two devices) to run the full M2 flow.

### Step 1 — Create a user and session
```bash
# Register
curl -X POST http://16.16.146.231/api/v1/auth/register/ \
  -H "Content-Type: application/json" \
  -d '{"username": "host_user", "email": "host@test.com", "password": "Pass1234!"}'

# Login — copy the access token from the response
curl -X POST http://16.16.146.231/api/v1/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username": "host_user", "password": "Pass1234!"}'

# Create a session (replace <ACCESS_TOKEN> and <BOOK_UUID>)
curl -X POST http://16.16.146.231/api/v1/sessions/ \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"book": "<BOOK_UUID>", "child_profile": null}'
```
Response returns: `session_id`, `invite_token`, `invite_url`

### Step 2 — Host enters the lobby
Navigate to the frontend:
```
http://16.16.146.231:3000/session/<SESSION_ID>/lobby
```
Allow camera and microphone when prompted. You will see the device check screen.

### Step 3 — Share the invite link
The invite link format is:
```
http://16.16.146.231:3000/invite/<INVITE_TOKEN>
```
Open this link in a second browser window (incognito) or a second device.

### Step 4 — Guest joins
Guest enters their display name and clicks "Join Session".
- Both windows proceed to the Reading Room automatically once both are ready.

### Step 5 — Verify each acceptance criterion

| Test | How to verify |
|---|---|
| AC-01: Video + audio | Both windows show live video feeds; audio transmits |
| AC-02: Page sync | In host window, click the right arrow (→). Guest window must update to the same page |
| AC-03: Annotation sync | Draw in host window; guest must see the strokes appear. Draw in guest window; host must see the strokes |
| AC-04: Timer | Host clicks "Start Session". Both windows show the same countdown. Wait for 5-min and 2-min warning banners |
| AC-05: Host controls | Guest window must NOT show page navigation arrows |

### Step 6 — Reconnection test
Disable network on one device for 5–10 seconds, then re-enable.
The "Reconnecting…" banner should appear, then resolve. Page and canvas state should be preserved.

---

## 3. API Quick-Test (Postman / curl)

### Check health
```bash
curl http://16.16.146.231/api/v1/health/
# Expected: {"status": "ok"}
```

### List books (verify book viewer has content)
```bash
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://16.16.146.231/api/v1/books/
```

### Get book pages (verify viewer loads)
```bash
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://16.16.146.231/api/v1/books/<BOOK_UUID>/pages/
```

### Get session snapshot (verify page persistence)
```bash
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://16.16.146.231/api/v1/sessions/<SESSION_UUID>/snapshot/
```

---

## 4. Key Files (for code review)

| File | What to review |
|---|---|
| `frontend/app/session/[id]/reading-room/page.tsx` | Full reading room: video, page sync, timer, annotation wiring |
| `frontend/app/session/[id]/lobby/page.tsx` | Pre-session camera/mic check and ready handshake |
| `frontend/app/invite/[token]/page.tsx` | Guest invite join flow |
| `frontend/components/annotation/AnnotationCanvas.tsx` | Fabric.js canvas, debounce, remote JSON load |
| `frontend/components/annotation/AnnotationToolbar.tsx` | Pen, eraser, colour picker, brush size |
| `backend/core/api_views.py` | `SessionListCreateView`, `InviteJoinView`, `SessionCompleteView`, `SessionSnapshotView` |
| `backend/core/models.py` | `ReadingSession`, `SessionInvite`, `SessionParticipant`, `SessionSnapshot` |

---

## Open Items (Carried to M6)

| Item | Priority | Notes |
|---|---|---|
| Cross-device QA (iOS Safari, Android Chrome) | High | Scheduled for M6 QA sprint |
| WCAG AA contrast audit on reading room UI | Medium | Covered in M6 accessibility check |
| Sentry error capture verification | Medium | Sentry DSN configured; alert rules to be confirmed in M6 |
| Load test at 100 concurrent sessions | Medium | LiveKit Cloud handles scaling; to be verified in M6 |

---

## Sign-Off

| Role | Name | Date | Signature |
|---|---|---|---|
| Developer | Zain Hyat | 17 April 2026 | |
| Client | | | |

---

*Bailey & Beau — Milestone 2 Completion Report*
*Prepared by Zain Hyat | 17 April 2026 | Confidential — For Client Review Only*
