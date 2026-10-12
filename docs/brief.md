# Weekly brief

The brief is built every Sunday from the papers announced Monday to Friday of the closing week, scheduled through Resend for Monday 07:00 in `app_settings.timezone` (Asia/Kolkata by default), and published at `/brief/<isoWeek>` (for example `/brief/2026-W41`). Code: `src/lib/brief/*`, stage wiring in `src/lib/pipeline/stages.ts`.

## Window

`briefWindow(now)` (`src/lib/brief/window.ts`) returns the latest complete week. `start` is Monday 00:00 UTC, `end` is Saturday 00:00 UTC, and the ISO week id is the week of `start`. On Sunday 11 Oct 2026 and on Monday 12 Oct 2026 it returns `2026-W41`, "Mon 5 Oct – Fri 9 Oct". A paper belongs to the window by `coalesce(announced_at, submitted_at, created_at)`. The footer prints "Covers announcements Mon 5 Oct – Fri 9 Oct".

## Structure

1. **Week line**: one sentence (≤ 25 words).
2. **Top 3**: the three highest `final` scores across all domains (each ≥ the compact threshold), with a pointer (≤ 30 words). In its domain section a Top 3 paper shows as "In Top 3: <title>" instead of a second card.
3. **One section per active domain**: situation, complication and implication (≤ 40 words together), then:
   - **HERO**: at most 1 paper with `final ≥ thresholds.hero` (0.60). Headline ≤ 10 words, lede ≤ 22 words, client angle ≤ 18 words, verdict reason ≤ 12 words.
   - **STANDARD**: at most 2 papers with `final ≥ thresholds.standard` (0.50). Headline, client angle, verdict reason.
   - **COMPACT**: at most 5 papers with `final ≥ thresholds.compact` (0.40). Title and cues only.
   - **Quiet**: a domain with no paper placed in it (after each paper goes to its best domain) says so and names its nearest miss with its score. The nearest miss is the domain's highest-scoring fresh paper that is not shown anywhere else in the brief, or, if every such paper is shown elsewhere, its highest-scoring paper overall.
4. **Rising**: up to 6 papers from earlier briefs whose Hugging Face upvotes rose ≥ 30% and by ≥ 10 against the snapshot from 7 days before, shown with `UP +NN%`.
5. **Footer**: the coverage window, each source that was FAILED or PARTIAL since the window started (from `source_runs`), whether the prose fell back, and the legend.

Each paper appears once, in the domain where its `final` is highest. Papers already in an earlier SCHEDULED or SENT brief are left out unless they are rising. The thresholds are the `hero`, `standard` and `compact` keys of `app_settings.thresholds`; the caps (1, 2, 5, rising 6) are constants in `src/lib/brief/select.ts`.

Every card shows the verdict as a color bar and a text label (`BRING TO CLIENT` `#D55E00`, `READ` `#0072B2`, `SKIP` `#8A8F98`), the evidence rung as `[##--] CODE` text, the signal type as a bordered chip (BENCH solid, EVAL dashed, REFRAME dotted, METHOD double), attention counts, and links to the abstract, PDF, code and Hugging Face when known. No cue relies on color or images alone.

## Prose rules

`composeBrief` (`src/lib/brief/compose.ts`) makes one `generateObject` call with the `BriefProse` schema and the rules in `src/lib/brief/prompts/compose.md`. Numbers may appear only as `{{ev:<cardId>.<field>}}` tokens, which `fillTokens` replaces with stored values (`1.2k`, `+38%`, unknown tokens become `n/a`). `validateProse` rejects word-cap breaches, digits outside tokens, the banned words, cards with empty `evidenceRefs`, any `evidenceRefs` entry that is not `<cardId>.<field>` with a card id from the selection and a known evidence field, and more than `prose_word_cap` (≤ 1,500) words in total. One repair call gets the error list; if that also fails, `fallbackProse` builds deterministic text from titles, first abstract sentences and stored client angles. Its domain intro is built from stored fields only: the number of placed papers (in words) and their most common signal type (situation), the lead card's evidence rung (complication) and its verdict (implication). A quiet domain gets "No paper landed in this domain this week." and a pointer to its nearest miss.

## Reading budget

At 10 domains: week line and Top 3 about 45 s, domain intros about 100 s, 10 HERO × 12 s, 20 STANDARD × 6 s and up to 50 COMPACT × 2.5 s, about 510 s (8.5 minutes) in total. Generated prose is capped at 1,500 words. If a timed read goes over 10 minutes, lower `thresholds.compact` (fewer compact rows qualify) and record the change here.

## Email

`renderEmail` (`src/lib/brief/email.ts`) builds 600 px nested tables with inline styles and no images or scripts. Each card carries signed Read / Bring to client / Skip links to `/a/<token>` (HMAC-SHA256 with `ACTION_LINK_SECRET`, valid 30 days). Opening a link renders a page that records the action from script, so link scanners record nothing; a `<noscript>` button covers mail clients without script. If the HTML is over 90,000 bytes, compact rows are replaced by "N more on the web" links to `/brief/<isoWeek>#d<domainId>`; for unusually large weeks the rising lane and then standard cards follow.

## Sunday run

`rs_weekly` (Sun 12:00 UTC) POSTs `/api/stage/weekly`, which runs `runWeekly()`:

1. Venue adapters (ACL, CVF, PMLR), a best-effort keyless Semantic Scholar refresh of the window's FINALISTs, and `recomputeCentroids()`.
2. `selectBrief`, then `finalRerank` (full text for the top 15 FINALISTs, one re-judging call, `final` recomputed), then selection again. The judgements are stored in the brief's `json.rerank`, keyed by paper and domain. A later run for the same ISO week reuses them and makes no second re-judging call, so repeated runs are idempotent. Only a real (not dry) `runWeekly` writes the re-judged signal type, novelty, client angle, `final` and verdict to `paper_domain`. `npm run smoke -- rerank`, the backfill preview and `DRY_RUN=1` runs apply them in memory only.
3. `composeBrief`, `fillTokens`, `renderEmail`; the brief row (`json`, `html`, `html_bytes`, window) and its `brief_items` are upserted, and the brief is indexed in `search_docs`.
4. `resend.emails.send` with `scheduledAt` = the brief week's send slot: the Monday after the window at `send_local_time` in `timezone` (07:00 IST = 01:30 UTC; for `2026-W41` that is Mon 12 Oct 2026 01:30 UTC). An earlier scheduled email for the same week is cancelled first. The brief becomes SCHEDULED and its papers SENT.
5. If no paper qualifies, the brief is marked FAILED, nothing is sent, and a `source_runs` row with `source_kind = 'brief'` records the alert.

**Send time for manual runs.** The slot belongs to the brief's window, not to the run time (`nextSendTime` in `src/lib/brief/window.ts`). A run on Sunday, or on Monday before 07:00 IST, schedules this Monday 07:00 IST. A run on Monday after 07:00 IST, or Tuesday to Friday, builds the same week's brief and sends it at once: `scheduledAt` is omitted, the brief becomes SENT with `sent_at` set and `scheduled_for` empty. It does not wait for the following Monday. From Saturday 00:00 UTC the next week is complete, and a run schedules the following Monday.

`rs_weekly_retry` (Sun 16:00 UTC) POSTs `/api/stage/weekly_retry`, which does nothing when this week's brief is SCHEDULED or SENT and otherwise runs the same steps.

`DRY_RUN=1` in the server environment skips the Resend call and logs the recipients, subject length, HTML size and `scheduledAt` (or "scheduledAt omitted (send now)") instead; the brief stays READY, no paper is marked SENT and no rerank score is written to `paper_domain`.

## Re-sending a brief manually

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "x-cron-secret: $CRON_SECRET" "$APP_URL/api/stage/weekly"
```

It returns `202` at once and rebuilds and re-schedules this week's brief in the background (cancelling the earlier scheduled email). After Monday 07:00 IST it sends at once instead, as described above. Against a local dev server use `APP_URL=http://localhost:3000`. Watch the outcome in `research_signal.source_runs` (stage `weekly`) and `research_signal.briefs`.

## Preview without sending

`npm run backfill -- --weeks 2` (see `scripts/backfill.ts`) loads two weeks of arXiv, runs embed1, embed2, scoring within an LLM budget (`--budget`, default $0.30) and enrichment, then stores a READY preview brief for the latest complete week and prints its id. It never sends email or marks papers SENT.
