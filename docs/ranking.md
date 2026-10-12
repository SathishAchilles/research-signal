# Ranking

How shortlisted papers are scored, ranked, enriched and given a verdict. The code lives in `src/lib/pipeline/score.ts`, `rank.ts` and `enrich.ts`. Rung and rising are computed by the `research_signal.evidence` view (`scripts/sql/004_views.sql`).

All tunable numbers are in the single `research_signal.app_settings` row, in the `thresholds` and `weights` JSON columns. Change them with SQL, for example:

```sql
update research_signal.app_settings
set weights = weights || '{"attention": 0.25, "validation": 0.10}'::jsonb, updated_at = now();
```

A missing or non-numeric key falls back to the default shown below. New values apply on the next `rankAll` (after every score and enrich job).

## Pipeline order

1. `embed1` keeps the top 40 papers per domain and announcement day with cosine ≥ `prefilter_floor`. They become PREFILTERED and the rest become DROPPED.
2. `embed2` stores the full embedding and recomputes cosine. The paper becomes SHORTLISTED.
3. `score` (LLM) rates relevance, novelty, signal type, client angle and risk flags. The paper becomes SCORED, then `rankAll` runs.
4. `rankAll` computes `final_score` and `verdict` in code. The top 10 per domain and announcement day become FINALIST, and `enrich` is queued.
5. `enrich` takes HF detail, then OpenReview, then Semantic Scholar, then runs `rankAll` again.

## LLM scoring (`score`)

- Model: `app_settings.chat_model`, temperature 0.2, 25 papers per call, 4 calls in parallel, at most 300 papers per job. If more remain, another `score` job is queued.
- Prompt: `src/lib/pipeline/prompts/score.md` holds the rubric and the untrusted-data notice. The active domains are appended to it. Papers are sent as `<paper id="pN" domains="…">` blocks.
- Output: zod schema `ScoreBatch`. Per paper it returns relevance for each candidate domain (0–5), `signalType`, `novelty` (0–5), `clientAngle` and `riskFlags`.
- `clientAngle` is cut to 18 words in code.
- A candidate domain the model leaves out gets relevance 0.
- A paper the model leaves out stays SHORTLISTED and is retried by the next job.

Signal types: BENCH (benchmark or dataset), EVAL (surprising or contrary evaluation), REFRAME (changes the problem framing), METHOD (a new method only).

## Final score

Computed by `finalScore()` in `src/lib/pipeline/rank.ts`:

| Component | Formula |
|---|---|
| relevance | `0.5·cosine + 0.5·(llm_relevance/5)` |
| significance | `0.6·(novelty/5) + 0.4·typeWeight`; typeWeight BENCH 1.0, EVAL 1.0, REFRAME 0.9, METHOD 0.6 |
| attention | `0.5·min(1, log10(1+upvotes)/2.5) + 0.3·min(1, log10(1+stars)/4) + 0.2·min(1, linked/5)`, where linked = linked models + linked Spaces |
| validation | rung LAB 0, CODE 0.33, MODEL 0.66, PEER 1 |

`final = relevance·w.relevance + significance·w.significance + attention·w.attention + validation·w.validation`

| `weights` key | Default | Multiplies |
|---|---|---|
| `relevance` | 0.35 | relevance |
| `significance` | 0.30 | significance |
| `attention` | 0.20 | attention |
| `validation` | 0.15 | validation |

Upvotes, stars and linked counts come from the latest `signals` snapshot. Missing values count as 0.

Worked example (`npm run smoke -- rank`): cosine 0.6, relevance 4, novelty 3, BENCH, 50 upvotes, 300 stars, 1 linked, rung MODEL gives 0.685, which is READ.

## Verdict

`verdictFor(final, rung, thresholds)`:

- CLIENT when `final ≥ client` and the rung is CODE, MODEL or PEER.
- READ when `final ≥ read`.
- SKIP otherwise.

So a paper scoring 0.75 at rung LAB is READ, not CLIENT.

## Thresholds

| `thresholds` key | Default | Used by |
|---|---|---|
| `prefilter_floor` | 0.20 | `embed1`: minimum centroid cosine to be kept |
| `client` | 0.70 | verdict CLIENT (also needs rung ≥ CODE) |
| `read` | 0.50 | verdict READ |
| `hero` | 0.60 | weekly brief: minimum `final` for the HERO tier |
| `standard` | 0.50 | weekly brief: minimum `final` for the STANDARD tier |
| `compact` | 0.40 | weekly brief: minimum `final` for the COMPACT tier |

## Evidence rung

The first rule that matches wins (`evidence` view):

1. **PEER**:
   - OpenReview venue text says accepted, oral, poster or spotlight; or
   - an OpenReview decision is stored that is not submitted or withdrawn; or
   - the paper came from ACL, CVF or PMLR; or
   - Semantic Scholar reports a non-empty venue that is not arXiv.
2. **MODEL**: linked models + Spaces > 0 (HF detail).
3. **CODE**: a GitHub repository is known (HF).
4. **LAB**: otherwise.

`enrich` writes `or_decision` only for an accepted OpenReview match. A rejected or under-review match stores only `or_venue` (for example "ICLR 2027 Conference Submission"), so the view does not read it as PEER.

## Rising

A paper is rising when its latest HF upvotes are at least 30% and at least 10 votes above the newest snapshot that is 7 or more days old. Example: 40 → 95 is rising. Rising papers are eligible for the brief's rising lane even after they were sent.

## Finalists

- `rankAll` re-ranks every scored row (SCORED, FINALIST or SENT) announced in the last 28 days.
- It promotes the top 10 per domain and announcement day from SCORED to FINALIST.
- FINALIST is never demoted, so enrichment already done is kept. SENT papers are re-scored but not promoted.
- When at least one paper is promoted, an `enrich` job is queued.

## Enrichment (`enrich`)

Each source writes its own `source_runs` row (stage `enrich`). If a source throws `SourceUnavailable`, its run is marked PARTIAL and the next source still runs.

- **HF detail**: up to 150 shortlisted-or-better papers from the last 14 days that have no detail snapshot (one with `linked_models`) from today, finalists first.
- **OpenReview**: FINALISTs from the last 14 days with no stored decision, best `final` first.
  - At most `sources.params.maxPerDay` lookups (10), or `maxPerSunday` (15) on Sunday, spaced 3.1 s apart.
  - Lookups are recorded in `sources.cursor.checked`, so a paper is searched again only after 7 days.
- **Semantic Scholar**: one keyless batch for FINALISTs from the last 14 days. It writes citations, venue and `builds_on` (top 2 references by citations).
  - If the batch fails, nothing is written, so earlier S2 values on the latest snapshot are kept.

Snapshots merge with the paper's latest one, so a partial write never hides earlier values.

## HF refresh (`hf_refresh`)

- Fetches HF detail for papers with status SHORTLISTED, SCORED, FINALIST or SENT that were announced in the last 10 days.
- Writes one new `signals` snapshot per paper that HF lists. Papers HF does not list (404) get none.
- These snapshots feed attention and rising.
- Trigger it with `POST /api/stage/hf_refresh` (header `x-cron-secret`), or queue it as a job.
