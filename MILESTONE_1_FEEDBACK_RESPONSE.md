# Milestone 1 — Client Feedback Response

**Bailey & Beau Interactive Family Reading & Activity Platform**

| | |
|---|---|
| **Milestone** | M1 — Foundation |
| **Response Date** | 12 April 2026 |
| **Feedback From** | Client |
| **Status** | Pending Final Approval |

---

## Items Verified by Client

The following M1 checks were confirmed by the client on the staging server:

| Item | Result |
|---|---|
| Staging server accessible | ✅ Verified |
| Admin dashboard loads | ✅ Verified |
| User creation and dashboard display | ✅ Verified |
| `/api/v1/health/` endpoint | ✅ Verified |
| User record in admin panel after registration | ✅ Verified |
| Admin navigation (books, activities, sessions, users, subscriptions, badges, logs) | ✅ Verified |

---

## Client Questions & Responses

---

### 1. Book Upload / Media Storage

**Client question:**
> When testing the Book Library → Add Book section, I did not see an option to upload an image or media file. Where are book assets uploaded from the admin UI? Is `/api/v1/admin/upload/` wired into the admin interface?

**Response:**

Book pages are managed in the Django admin under **Books → Book Pages**. Each BookPage record holds an `image_url` field that points to the hosted asset (S3 or local media).

The upload workflow at this stage:

1. Make a `POST` request to `/api/v1/admin/upload/` (staff-authenticated) with the file as `multipart/form-data`
2. The endpoint returns the hosted URL of the uploaded file
3. Paste that URL into the `image_url` field of the corresponding BookPage record in the admin panel

The endpoint is live and functional. A drag-and-drop upload UI directly inside the admin panel is planned for **M3 (Content Management)** per the BA scope. For M1 the storage layer and upload endpoint are verified working.

A Postman collection demonstrating the full upload flow will be shared separately.

---

### 2. Error Monitoring (Sentry) ✅ Complete

**Client question:**
> Milestone 1 includes Sentry error monitoring. Please trigger a test error and confirm it appears in the Sentry dashboard.

**Response:**

Sentry is now fully integrated and verified. Here is what was completed:

- ✅ `sentry-sdk 2.57.0` installed and added to `requirements.txt`
- ✅ `SENTRY_DSN` added to the production environment
- ✅ `sentry_sdk.init()` wired into `config/settings.py` — activates automatically in production, silent in local dev if DSN is not set
- ✅ Test event successfully captured: **"Sentry test — Bailey and Beau platform monitoring check"** appeared in the Sentry dashboard within seconds of being triggered

The integration is environment-aware:

- `environment: production` when `DEBUG=false`
- `environment: development` when `DEBUG=true`
- `traces_sample_rate: 0.2` — 20% of transactions tracked for performance monitoring
- PII (emails, IPs) is not sent to Sentry

A screenshot of the test event in the Sentry dashboard is available on request.

---

### 3. GitHub Repository Access

**Client question:**
> Please share access to the repository and confirm the CI pipeline is present, including `.github/workflows/ci.yml`.

**Response:**

The repository is ready to share. Please provide your GitHub username and collaborator access (read) will be granted immediately.

The CI pipeline is confirmed present at `.github/workflows/ci.yml` and runs automatically on every push to `main` and on all pull requests. It covers:

| Job | What It Does |
|---|---|
| `backend` | Python 3.12 — installs deps, runs all 70 Django tests |
| `frontend` | Node 20 — installs deps, runs ESLint, builds Next.js |

Both jobs run in parallel on GitHub Actions.

---

### 4. Database Configuration

**Client question:**
> Confirm production will use PostgreSQL, there is a migration plan from SQLite → PostgreSQL, and the schema was designed with PostgreSQL in mind.

**Response:**

| Environment | Database |
|---|---|
| Staging | SQLite (zero infrastructure overhead for verification) |
| Production | PostgreSQL on AWS RDS (`eu-north-1`, already provisioned) |

**PostgreSQL readiness:**
- All models use `UUIDField` primary keys — PostgreSQL native
- No SQLite-specific queries or functions anywhere in the codebase
- Django migrations are the single source of truth and run cleanly against a fresh PostgreSQL database

**Migration plan from SQLite → PostgreSQL:**
There is no data to migrate — staging contains only seed and test data. Production starts with a clean RDS PostgreSQL instance and Django migrations run against it on first deploy. No `pg_dump` or data transfer is required.

---

### 5. Scope Clarification

**Client question:**
> Confirm that any work beyond the defined milestone scope will not be billed without approval first.

**Response:**

Confirmed. The additional improvements included in the M1 delivery (sidebar UX polish, live badge counts, session log counts) were absorbed into M1 at no additional cost and are noted as such in the completion report.

Going forward:
- Any work outside the defined milestone scope will be flagged **before** it is started
- No out-of-scope work will appear on an invoice without prior written approval
- The milestone structure (M1–M6) remains the billing reference

---

## Outstanding Actions Before M1 Approval

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Sentry integration and dashboard verification | Zain | ✅ Complete |
| 2 | Client provides GitHub username for collaborator invite | Client | Awaiting |
| 3 | Postman collection for `/api/v1/admin/upload/` | Zain | In progress |

---

## Next Steps

Once the GitHub username is received and the Postman collection is shared, M1 will be formally closed.

M2 (FR-01 — Video Session & Reading Room) is already underway. The core session lifecycle, LiveKit room creation, token generation, invite system, and reading room frontend are implemented and passing all tests locally. M2 will be ready for staging deployment promptly after M1 approval.
