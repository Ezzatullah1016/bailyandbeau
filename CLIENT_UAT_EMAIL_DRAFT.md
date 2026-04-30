# Email draft — Milestone 3 client testing procedure

Copy everything **below the horizontal rule** into your email client. Replace bracketed placeholders.

---

**Subject:** Bailey & Beau — Milestone 3 (Activity Room): step-by-step testing guide

Dear [Name],

Milestone 3 delivers the **Activity Room** functionality inside a live reading session: interactive activities driven by server-side configuration, synchronised between host and guest over the live session, with progress recoverable after refresh where applicable.

Below is a **working procedure** so you can validate Milestone 3 end-to-end on your side. For background on feedback items already addressed (library flow and branding), see **`CLIENT_FEEDBACK_AND_MILESTONE_3_COMPLETION.md`** in the project materials.

---

### What you need before testing

- **Two contexts for sync checks:** two browsers (or one normal window + one private/incognito), or two devices — one **host** and one **guest**.
- **A book that has activities configured** (for example the demo “Colour Adventure” style title if your environment includes seeded activities). If **Start activity** is disabled or shows “No activities”, that book has no active activity configs; use another title or ask us to attach activities to a book for UAT.
- **Sessions remaining** on the test account (host must be able to create a session).

---

### Access / URLs (staging)

Replace the host if your staging URL differs.

| Step | URL |
|------|-----|
| Sign in | http://16.16.146.231/login |
| Dashboard | http://16.16.146.231/dashboard |
| Library | http://16.16.146.231/dashboard/library |

**Reading room** (after you start a session and proceed through lobby):  
`http://16.16.146.231/session/<SESSION_ID>/reading-room`  
(You normally reach this from the app after **Start session** and lobby; you do not need to type the URL by hand.)

---

### Test account (staging)

**Reviewer login** (rotate password after testing):

- **Username:** `client-review`  
- **Password:** `BaileyBeauReview2026!`

If this user is missing on the server, your technical contact runs from the backend directory (after migrations):

`python manage.py seed_client_review_user`

---

### Milestone 3 — recommended testing procedure

**A. Host setup**

1. Open the **login** URL and sign in with the test account above.  
2. Go to **Dashboard** → **Start Session** (or **Library** → **Open book** on a title that has activities, then start a session from the dashboard with that book pre-selected).  
3. Choose a **child profile** and create/start the session.  
4. Complete **lobby** steps until you are in the **reading room** as **host**.  
5. Copy the **guest invite link** (or invitation flow your product uses) for the second participant.

**B. Guest setup**

6. In the **second browser** (or incognito), open the invite link, enter a guest display name, and join until the guest is also in the **reading room**.

**C. Activity workflow (core Milestone 3)**

7. Confirm both sides see the book pages and normal reading-room controls.  
8. On the **host** side only, click **Start activity**.  
9. Confirm the **guest** sees the activity overlay open **without** clicking Start activity themselves.  
10. Work through each activity type available on that book (examples below — test whatever your content provides):

    - **Quiz:** Host and guest can select options; if the config uses **host-controlled reveal**, the host uses **Reveal answer** and the guest sees the result.  
    - **Drawing:** Host draws / erases / clears; guest canvas updates to match.  
    - **Drag and drop:** Host assigns items to zones; guest sees the same assignments.  
    - **Hotspot:** Host activates hotspots; guest sees the same active content when synced.

11. Use **Next** / **Previous** (host controls) to move between activities on the same book; confirm the guest follows the same activity.  
12. Host clicks **Reset** on an activity where applicable; confirm both sides reset.  
13. Host closes the activity panel (**Close**); confirm both sides return to the normal reading view.

**D. Reconnect / refresh (Milestone 3 resilience)**

14. With an activity **open** and some interaction done (e.g. quiz selection or strokes), **refresh the browser** on one participant only.  
15. After rejoining the reading room, confirm **activity open state**, **which activity index**, and **shared state** recover reasonably (within normal session limits).

**E. Report issues**

16. For any defect, send: **steps**, **browser + version**, **host vs guest**, and **screenshots or screen recording** if possible.

---

### Optional — local environment (developers only)

- App: `http://127.0.0.1:3000` — API: `http://127.0.0.1:8000/api/v1`  
- After `seed_demo_data`: `demo-parent` / `Demo123!` (local demo only, not for staging/production).

---

We are happy to schedule a short walkthrough if that helps your first run.

Kind regards,  
[Your name]  
[Role / Company]
