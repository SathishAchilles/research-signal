# End-to-end check (task 13.1)

This check runs the weekly brief from trigger to inbox in production (<https://research-signal.vercel.app>). Do it on a Sunday, or start it by hand. It can only be completed after:

- the `rs_*` cron jobs exist (`scripts/sql/005_cron.sql`, task 12.5);
- the user has approved one real send.

Status: run on Tue 13 Oct 2026 (IST) with one approved forced send of `2026-W41`. Every item that can be checked without the inbox passed. Three items are pending the user: the email arriving in the inbox, clicking an action in the real email, and the 07:00 IST timing.

## Checklist

- [x] **Trigger.** Send `POST /api/stage/weekly` in production with the cron secret, or let `rs_weekly` fire. Record the date, time and HTTP status.
  This run used the manual re-send path from `docs/brief.md` instead: `runWeekly({ force: true, dryRun: false })` in a one-off `tsx` process with `.env.local` (production `APP_URL`), after production deployment `research-signal-m5pntb3vv` (commit `31222a4`) was Ready. It was run once and was not retried.
- [x] **Brief sent.** `select id, iso_week, status, resend_id, scheduled_for, sent_at, html_bytes from research_signal.briefs where iso_week = '2026-W41'` returns `status = SENT`, `sent_at` set and `scheduled_for` empty. That is expected: the Monday 12 Oct 01:30 UTC slot had already passed, so `force` sends at once instead of scheduling. A Sunday run would give `SCHEDULED` with `scheduled_for` on Monday at 01:30 UTC.
- [x] **Resend accepted.** Resend accepted the email and returned an id. `GET /emails/{id}` returns `401 restricted_api_key`, because the production key can only send. The user can see the delivery status in the Resend dashboard.
- [ ] **Arrival** (pending-user). The email arrives in `sathish_babu@pg27.mesaschool.co`. Record the actual arrival time. Only a scheduled Sunday run shows that it arrives at 07:00 IST.
- [x] **Content.** The stored html (the exact html that was sent) contains:
  - [x] a section for every active domain (4 of 4). No domain was quiet this week, so the nearest-miss line did not appear;
  - [x] the footer coverage window ("Covers announcements Mon 5 Oct – Fri 9 Oct");
  - [x] source health (one entry: Hugging Face was unavailable at times).
- [x] **Action link, plain GET.** One signed `/a/<token>` link from the stored html opens on production with `GET 200` and the valid-link page ("Action:" shown, no "This link is not valid"). `research_signal.actions` had 24 rows before the GET and 24 after, so a plain GET recorded nothing. A tampered token gets the "not valid" page.
- [ ] **Action link, click** (pending-user). Click one action link in the email (Read, Share with clients or Skip). Check that `select action, origin, created_at from research_signal.actions order by created_at desc limit 1` shows the new row with `origin = 'email'`.

## Results

| Check | Result | Evidence |
|---|---|---|
| Trigger | Pass (manual force) | Tue 13 Oct 2026 ~04:02 IST (12 Oct 22:32 UTC). `runWeekly({ force: true })` returned `OK`, 32 cards, "prose llm; 71418 bytes; sent at once" |
| Brief sent | Pass | brief `2f7a07b5-fdd2-43bf-bf1c-2d971f580fa6`, `2026-W41`, `SENT`, `sent_at 2026-10-12 22:32:29.954+00`, `scheduled_for` null, `html_bytes 71418` (< 90,000) |
| Resend accepted | Pass (accepted). Delivery status pending-user | Resend id `01a13240-e48b-7665-aeab-b521aa903eb6`. Recipient `sathish_babu@pg27.mesaschool.co` (only entry in `app_settings.recipients`). `GET /emails/{id}` returned `401 restricted_api_key` (send-only key) |
| Arrival | Pending-user | Inbox arrival time not recorded yet. The 07:00 IST timing needs a scheduled Sunday run |
| Content | Pass | 4/4 active domains present (AI agents, Retrieval-augmented generation, LLMs for code, Computer vision for industrial applications); footer window present; source-health block present; "SHARE WITH CLIENTS" label present |
| Action link | Plain GET: pass. Click: pending-user | 96 action links, all on `https://research-signal.vercel.app`. GET 200 on the valid page; `actions` count 24 → 24 |
