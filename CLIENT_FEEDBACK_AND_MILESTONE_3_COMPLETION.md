# Client Brief: Product Feedback and Milestone 3 Completion

**Project:** Bailey & Beau Reading Platform  
**Reference plan:** `milestone_3_delivery_plan_fb769c2e.plan.md`  
**Document purpose:** Record client feedback in a traceable form and report Milestone 3 delivery status against the agreed plan.  
**Date:** 30 April 2026  

---

## Part A: Client Feedback

### A.1 Summary

| ID | Theme | Client input (paraphrased) | Product impact | Resolution (implemented or planned) |
|----|--------|----------------------------|----------------|--------------------------------------|
| F-01 | Discovery / navigation | After sign-up and login, the user could see books in the library but was unsure **how to open a book** or how the layout leads into a live reading session. | Risk of abandonment at first successful login; support burden. | **Library:** Added an on-page explanation of the flow (“How to open a book”), with a clear primary action **Open book** on each card. **Routing:** `Open book` deep-links to the dashboard with `?startBook=<book_id>` so the correct title is pre-selected in **Start a session**. |
| F-02 | Brand identity | Request to adopt **specific brand colours**, **two typefaces** (Baloo for titles, Karla for body), and a **logo** across the platform. | Stronger brand recognition and alignment with client visual identity. | **Typography:** Baloo 2 (headlines) and Karla (body) via Next.js font loading. **Colour system:** Navy `#3d3b62` as primary shell, light pink `#eccdca` for contrast text on dark surfaces, plus purple, bright pink, teal, and yellow accents as specified. **Logo:** `public/brand-logo.svg` plus a reusable `BrandLogo` component (with wordmark fallback). Client may replace the SVG asset with final artwork without code changes. |

### A.2 Detailed feedback notes

**Navigation and book entry (F-01)**  
The library already listed books and filters, but the call-to-action previously pointed users toward the dashboard in a way that did not make the next step obvious. The experience is now explicit: users are told that opening a book lands them on the dashboard with that book pre-selected, then they choose a child profile and start a session, after which the normal lobby and reading-room flow applies.

**Branding (F-02)**  
The client supplied a cohesive palette and typographic rules. These are applied to key authenticated surfaces (for example dashboard, library, sidebar, and login) and to global design tokens so future screens can stay on-brand. The logo path is intentionally simple so the marketing team can drop in a final vector or raster file under the agreed public URL.

### A.3 Client actions (optional)

- Replace `frontend/public/brand-logo.svg` with the final approved logo file (same filename, or extend `BrandLogo` to prefer a PNG if preferred).  
- Validate colours and type on real devices (tablet and phone) and note any contrast tweaks for WCAG if required for your compliance tier.  

---

## Part B: Milestone 3 Delivery Plan Completion

This section maps delivery to **`milestone_3_delivery_plan_fb769c2e.plan.md`**: goals, schema freeze, backend contract, frontend engine, four activity types, admin workflow, resilience, and testing.

### B.1 Executive summary

Milestone 3 aimed to deliver a **config-driven Activity experience** (four activity types), **strict configuration validation**, **real-time sync** with the existing reading session, and **reconnect-safe state** via snapshots. **Core scope is implemented and covered by automated backend tests and frontend lint and production build.** Some plan items (full admin template library, extended analytics logging, formal client QA sign-off) remain **follow-up** work rather than blockers to demonstrating M3 in staging or UAT.

### B.2 Plan alignment (by section)

| Plan area | Status | Notes |
|-----------|--------|--------|
| **M1 / M2 baseline confirmation** | Pending client sign-off | Plan recommends confirming M1/M2 with the client using existing completion reports and CI. Technical evidence remains in `MILESTONE_1_COMPLETION.md`, `MILESTONE_2_COMPLETION.md`, and GitHub Actions CI. |
| **Schema freeze (`1.0`)** | **Complete** | Envelope and type-specific `payload` rules are enforced in `ActivityConfig.clean()` with `save()` calling `full_clean()`. Demo seed data uses valid `1.0` configs. |
| **Backend validators and API contract** | **Complete** | Admin API and model validation reject invalid configs (including missing `schema_version`, type mismatch, and invalid payloads). `GET /api/v1/books/<book_id>/activities/` returns active configs in order. **Guests** in a session may call the same endpoint with `?participant_id=` when the participant belongs to a session on that book. |
| **Frontend activity engine and LiveKit protocol** | **Complete (as implemented)** | `ActivityRoom` coordinates host and guest state. Data messages used in production include `ACTIVITY_OPEN`, `ACTIVITY_SYNC`, `ACTIVITY_NAV`, and `ACTIVITY_CLOSE` (the plan draft listed alternate names such as `ACTIVITY_INIT`; behaviour is equivalent: open, sync, navigate, close). |
| **Four activity types + reconnect** | **Complete (functional)** | Drawing (canvas-based sync), drag-and-drop (host assigns items to zones), quiz (including host-controlled reveal), and hotspot (host-triggered regions) are implemented. **Session snapshot** persists `activity_state` (`activity_open`, `activity_index`, `state_by_activity`) and the reading room restores it after refresh or reconnect, consistent with the plan’s resilience goals. |
| **Admin / content workflow guardrails** | **Partial** | Super-admin and API paths validate JSON against the frozen schema. **Not yet delivered:** rich template presets per activity type and dedicated UX polish called out in the plan’s “Admin UX for non-developer operations” (beyond validation errors). |
| **Observability** | **Partial** | Session and activity behaviour benefit from existing session infrastructure; **dedicated activity lifecycle analytics** as a separate stream was not expanded in this increment. |
| **Testing and exit criteria** | **Technical gate met; formal QA pending** | Django `core` test suite passes (including activity config and snapshot tests). Frontend passes ESLint and `next build`. **Client UAT** and the plan’s full manual matrix (multi-device, host transfer mid-activity, load) remain for formal sign-off. |

### B.3 Evidence (for audit trail)

- **Backend:** `python manage.py test core` completes successfully (full `core` app test run in development).  
- **Frontend:** `npm run lint` and `npm run build` complete successfully.  
- **Key implementation references:** `backend/core/models.py` (`ActivityConfig`), `backend/core/api_views.py` (`BookActivityListView`), `frontend/components/activity/ActivityRoom.tsx`, `frontend/app/session/[id]/reading-room/page.tsx`, `frontend/lib/api.ts` (`getBookActivities`, `updateSnapshot`).  

### B.4 Known gaps and recommended next steps

1. **Admin content velocity:** Add curated JSON templates or form sections per activity type so non-developers rarely touch raw JSON.  
2. **Drawing stack:** The plan mentioned deeper integration with the existing annotation canvas stack; the current activity drawing uses a dedicated canvas tuned for activity sync. Unify or reuse Fabric only if product design requires a single drawing engine.  
3. **Hotspot and drag-drop coordinates:** Normalisation across extreme viewport sizes should be explicitly tested on your target devices.  
4. **Formal M3 sign-off:** Run the agreed manual QA matrix (including reconnect during each activity type) on staging, then record sign-off in a short one-page QA summary.  

### B.5 Client acceptance checklist (Milestone 3)

Use this list to confirm Milestone 3 meets your expectations before sign-off.

**Configuration and API**

- [ ] Invalid activity configs are rejected at save time with clear errors.  
- [ ] Valid configs appear in order via `GET .../books/<book_id>/activities/`.  
- [ ] Snapshot `PUT` / `GET` round-trips `activity_state` as expected.  

**Reading room and activities**

- [ ] Host can open activities; guest follows without manual refresh.  
- [ ] Drawing, drag-and-drop, quiz, and hotspot each behave as described in your UAT script.  
- [ ] Refresh or disconnect mid-activity restores open state, index, and shared state where applicable.  

**Feedback items (Part A)**

- [ ] Library flow is clear to a first-time parent tester.  
- [ ] Brand colours, Baloo/Karla, and logo appear correctly on dashboard, library, sidebar, and login.  

---

## Closing

Part A captures your feedback and how the product has responded. Part B states honestly what is complete relative to **`milestone_3_delivery_plan_fb769c2e.plan.md`**, what is partial, and what remains for a polished release and formal sign-off. The development team recommends scheduling a short **UAT session** on your staging environment to tick Part B.5 and close Milestone 3 from a commercial perspective.

If you want this brief exported to PDF or adapted to your company letterhead, say which format and we can align layout only (no scope change).
