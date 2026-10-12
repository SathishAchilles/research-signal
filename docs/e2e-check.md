# End-to-end check (task 13.1)

This check runs the weekly brief from trigger to inbox in production (<https://research-signal.vercel.app>). Do it on a Sunday, or start it by hand. It can only be completed after:

- the `rs_*` cron jobs exist (`scripts/sql/005_cron.sql`, task 12.5);
- the user has approved one real send.

Status: not run yet.

## Checklist

- [ ] **Trigger.** Send `POST /api/stage/weekly` in production with the cron secret, or let `rs_weekly` fire. Record the date, time and HTTP status.
- [ ] **Brief scheduled.** `select id, iso_week, status, resend_id, scheduled_for from research_signal.briefs order by window_end desc limit 1` returns `status = SCHEDULED` and `scheduled_for` on Monday at 01:30 UTC. Record the brief id, ISO week and `resend_id`.
- [ ] **Resend scheduled.** The Resend dashboard shows the email scheduled for Monday 01:30 UTC. Record the Resend email id.
- [ ] **Arrival.** The email arrives at 07:00 IST. Record the actual arrival time.
- [ ] **Content.** The email contains:
  - [ ] a section for every active domain, including quiet domains with their nearest miss;
  - [ ] the footer coverage window;
  - [ ] source health.
- [ ] **Action link.** Click one action link in the email (READ, CLIENT or SKIP). Check that `select action, origin, created_at from research_signal.actions order by created_at desc limit 1` shows the new row with `origin = 'email'`.

## Results

| Check | Result | Evidence |
|---|---|---|
| Trigger | | |
| Brief scheduled | | |
| Resend scheduled | | |
| Arrival | | |
| Content | | |
| Action link | | |
