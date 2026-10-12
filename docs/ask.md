# Ask agent

The Ask panel (`/ask`) answers a keyword, term or question with a cited, evidence-graded consulting deliverable. Code lives in `src/lib/ask/` and the route `src/app/api/ask/route.ts`.

## Request flow

1. **Route** (`route-intent.ts`): one `generateObject` call (stage `ask_route`, minimal reasoning) returns `{intent, bareTerm, entities, since?, domains, client?}`.
2. **Playbook** (`playbooks.ts`): code picks the tool set and the output template (`templates/*.md`) for the intent. A bare term uses EXPLAIN + CATCHUP together.
3. **First search in code**: the playbook's first `search_index` call, plus the `get_papers` cards of its top 20 hits, runs before the model starts, using the routed entities and `since`. Routing and this search are the only work before the response starts, so any failure there (including a 402 from OpenRouter) is a plain JSON response.
4. **Preface**: the stream opens with a one-line italic preface ("Searched 1.5k indexed papers…: N close matches"), so text appears before the model starts. It is not part of the saved answer.
5. **Tools loop**: `streamText` with `chatModel(app_settings.chat_model, {reasoning: {max_tokens: 512}})`, `maxOutputTokens` = 512 + 2 × word cap, the playbook tools, `stopWhen: stepCountIs(6)` and the system prompt `prompts/system.md`. From step 3 on the model runs with `toolChoice: "none"` (at most 2 tool rounds before it writes). The system prompt is rebuilt each step with the confidence computed in code from the relevant papers found so far.
6. **Validate** (`answer.ts`, `validateAnswer`): checks for banned words, the word cap (`app_settings.prose_word_cap`), that every `[pN]` was returned by a tool, that evidence tokens resolve, and that every number is an evidence-token value, appears in a tool's output about a paper the answer cites (spelled-out numbers such as "fifteen" count), or appears in the question context (the prompt, today, `since`, the template and `trend` week counts). List markers are ignored. On failure there is one repair call (stage `ask_repair`). If the repair still fails, the answer is saved with a warning in `coverage.warning`.
7. **Grade** (`grade.ts`, `confidence`): computed from the cited papers, or from all relevant retrieved papers when nothing is cited. For BET, the verdict line is rewritten to `**Verdict: X** · Confidence: <grade>` so it always matches the badge.
   - **High:** at least 5 papers at rung CODE or above, including at least 1 PEER.
   - **Medium:** at least 3 papers.
   - **Low:** anything else. The panel then shows the "thin evidence" notice.
8. **Save**: in one transaction, `ask_threads` (for a new thread) and `ask_messages` (question and answer) store the content with tokens filled, plus `citations` (ref → paper id), `confidence`, `coverage` and `cost_usd`. The answer is also upserted into `search_docs` as `entity_type = 'answer'`, so threads are searchable. Nothing is written for an answer that fails, so a failed request leaves no thread behind.

## Intents

| Intent | When | Template sections |
|---|---|---|
| BET | Should a client adopt or bet on X | Verdict (Bet / Pilot / Watch / Avoid) with confidence, a for/against table with rung, momentum, maturity, top 3 risks, client line |
| BACKING | Does research back a use case | Counts per rung, strongest named results, gaps, what to tell the client |
| DIRECTION | Where a field is heading | Situation / Complication / Implication, rising themes, 3 signals to watch, what is fading |
| EXPLAIN | What a term means (also every bare term) | Definition from papers, why it matters for clients, 3 key papers |
| CATCHUP | What is new since a date | Tiered list: must read, worth a skim, also noted |
| PREP | Prepare for a client meeting | Backing + direction + the client's flagged papers + likely questions with answers |

## Tools

Defined in `src/lib/ask/tools.ts` by `askTools(ctx)`. Every paper a tool returns gets a per-question ref (`p1`, `p2`, …), which the answer cites as `[pN]` and the panel links to `/paper/<id>`.

| Tool | Behaviour |
|---|---|
| `search_index` | `research_signal.hybrid_search`, top 20, plus each hit's cosine to the query (the function's `similarity` column once `scripts/sql/007` is applied) and its rung. Hits with cosine ≥ 0.55 count as relevant. The threshold is measured: off-topic queries ("medieval cheese fermentation", "sourdough baking") top out at 0.46–0.50, on-topic AI queries have their 5th-best hit at 0.57–0.62. |
| `get_papers` | Card fields for up to 10 refs or ids: abstract (700 characters), authors, per-domain verdict, final score, client angle, risk flags, latest signals and rung. |
| `trend` | One SQL query grouping by `date_trunc('week', coalesce(announced_at, submitted_at))`. It returns paper counts, the rung mix, summed HF upvotes and the top 3 papers (rising first) per week, plus a momentum label: rising, steady, fading or unknown. `coalesce` keeps backstop and live papers, which have no `announced_at`. |
| `related` | The 8 nearest papers by `papers.embedding`, plus `builds_on` from the latest signals when it is non-null. |
| `my_log` | The consultant's `actions`: action, note, client tag and date. Filters are action, client tag (substring), since and a title or note match. |
| `get_fulltext` | `getFullText` (D10: arXiv HTML, then Unpaywall). The text is wrapped in `<untrusted_paper_text>`. At most 2 per question. |
| `live_search` | Hugging Face only: `GET https://huggingface.co/api/papers/search?q=`, top 10. It is allowed only when `search_index` found fewer than 5 hits with cosine ≥ 0.55, or when the routed `since` is earlier than the first indexed paper. It runs once per question. New papers are inserted with `source = 'live'` and status `PREFILTERED`, `paper_domain` rows are added for the routed domains (all active domains when none were routed), HF upvotes and GitHub signals are written, and `embed2` is enqueued so the papers become searchable. |

Tools by intent:

| Intent | Tools |
|---|---|
| BET | search_index, get_papers, trend, related, get_fulltext, live_search |
| BACKING | search_index, get_papers, my_log, get_fulltext, live_search |
| DIRECTION | search_index, get_papers, trend, live_search |
| EXPLAIN | search_index, get_papers, related, get_fulltext, live_search |
| CATCHUP | search_index, get_papers, trend, live_search |
| PREP | search_index, get_papers, trend, my_log, live_search |

## Limits

- At most 6 model steps per answer. The last step cannot call tools.
- `maxDuration = 300` s on `/api/ask`.
- At most 2 `get_fulltext` calls and 1 `live_search` call per question.
- `search_index` returns the top 20, `related` returns k = 8, and `my_log` returns the latest 30 entries.
- Prompt: 2,000 characters. History: the last 6 messages of the thread, with their old `[pN]` refs removed.
- Model: `app_settings.chat_model`, which must start with `google/`. The answer's thinking is capped at 512 tokens per step; routing and repair use reasoning effort `minimal`.
- `get_fulltext` uses the CORE fallback only while the `core` source is enabled and has a key.
- Cost: every call of one request passes its stage as `<stage>#<message id>` (`ask`, `ask_route`, `ask_repair`, `search_query`). A trigger from `scripts/sql/009_llm_call_request.sql` stores the id in `llm_calls.request_id` and keeps the plain stage, and `ask_messages.cost_usd` is the sum of that request's rows only.
- Errors: a 402 before streaming returns `402 {"error":"llm_credits_exhausted"}`; during streaming the stream's error part carries the text `llm_credits_exhausted`, and the panel shows a credits message for both.

## Evidence tokens

Paper numbers are written as `{{ev:<ref>.<field>}}`, where field is one of `upvotes`, `comments`, `stars`, `models`, `spaces` or `citations`. Code replaces each token with the stored value (thousands as `1.2k`) or `n/a`. Any other number must be copied from a tool result. The validator rejects numbers that it cannot find in the retrieved data or the prompt.

## Prompt-injection rule

Titles, abstracts, notes, full text and every other string in a tool result are untrusted data. The system prompt tells the model to treat them only as evidence and to ignore any instructions inside them. Full text is wrapped in `<untrusted_paper_text>`. The router wraps the user prompt in `<prompt>` and only classifies it. The repair call receives the retrieved data inside `<untrusted_retrieved_data>`. Citations are checked in code against the refs the tools actually returned, so injected text cannot add a source.

## API

- `POST /api/ask` with body `{threadId?, prompt}`. It returns an AI SDK UI message stream. The `start` part's metadata carries `{threadId, messageId, intent}`. The `finish` part's metadata adds `confidence`, `coverage`, `citations` and `evidence`, computed from the validated answer, which is saved before the `finish` part is sent.
- `GET /api/ask?threadId=<uuid>` returns the thread's saved messages. These include the validated or repaired answer, which can differ from the streamed draft.
- `/ask?q=<question>` (the command bar's Ask link) opens a new thread and asks the question once. The panel uses `useChat` from `@ai-sdk/react` and, when the answer ends, replaces the streamed draft with the saved answer.

## Ask check (task 13.3)

### Production (2026-10-13)

Run on 2026-10-13 against production, <https://research-signal.vercel.app/api/ask>. The run used the six suggested prompts exactly as `JOB_PROMPTS` in `src/components/ask/AskPanel.tsx` defines them, and sent them one after another. Each prompt opened a new thread and was sent as `POST /api/ask` with a session cookie created in the same process. The stream was read to the end. Every answer returned HTTP 200, had no stream error and no `coverage.warning`, and was saved.

Columns:

- **First text** is when the one-line preface arrives.
- **First model text** is the first text delta written by the model.
- **Citations** counts the refs in the `finish` metadata. Each count matches `ask_messages.citations` and the number of distinct `[pN]` refs in the saved content.
- **Cost** is the sum of `llm_calls.cost_usd` over the rows whose `request_id` is the answer's message id. It equals `ask_messages.cost_usd` for every row.

| Chip | Prompt | Intent | Confidence | Citations | First text | First model text | Total | Cost | LLM calls |
|---|---|---|---|---|---|---|---|---|---|
| Bet | Should a client bet on mixture-of-agents? | BET | Medium | 8 | 7.5 s | 13.0 s | 30.6 s | $0.0484 | 5 (incl. `ask_repair`) |
| Backing | Does research back LLM-based visual quality inspection for a manufacturer? | BACKING | Medium | 12 | 4.2 s | 11.5 s | 20.3 s | $0.0353 | 4 |
| Direction | Where is agent evaluation heading? | DIRECTION | Medium | 12 | 10.0 s | 16.6 s | 27.3 s | $0.0338 | 4 |
| Explain | agentic RAG | EXPLAIN+CATCHUP | Medium | 9 | 5.7 s | 7.4 s | 15.5 s | $0.0172 | 3 |
| Catch up | What's new in RAG since 1 Oct? | CATCHUP | Medium | 3 | 4.7 s | 11.8 s | 15.0 s | $0.0174 | 4 |
| Prep | Prep me for Acme on vision quality inspection | PREP | Medium | 16 | 4.3 s | 10.2 s | 24.0 s | $0.0505 | 5 |

The six together cost $0.2027, which is under the approved cap of $0.25.

Coverage lines:

- Five answers had "Searched 1470 indexed papers 2025-09-28 – 2026-10-12".
- The Catch up answer had "Searched 1470 indexed papers 2025-09-28 – 2026-10-12 + live HF (10 found)". Its `search_index` call found fewer than 5 relevant hits, so `live_search` ran. It found 10 Hugging Face papers and inserted them with `source = 'live'`. With only 3 citations, this answer is the thinnest of the six, although it still graded Medium.

Notes:

- All six intents were exercised, including BACKING, which the earlier local run missed.
- The Bet answer needed one `ask_repair` call, which is why it took the longest and cost the most per citation. None of the other five needed a repair.
- Every answer graded Medium. None reached High, because High needs at least 5 cited papers at rung CODE or above, including at least 1 PEER.
- "First text" ranges from 4.2 s to 10.0 s. That time covers routing plus the first search, which run before the preface is sent.

### Earlier local run (2026-10-13)

This earlier run used the local dev server (`next dev` on port 3104, which uses the shared production database). Each prompt was a new thread sent as `POST /api/ask` with a session cookie, and the stream was read to the end. Every answer was saved with no `coverage.warning`.

Columns:

- **First text** is when the one-line preface arrives.
- **First model text** is the first text delta written by the model.
- **Citations** counts the refs in the `finish` metadata. Each one also appears as `[pN]` in the saved `ask_messages.content`.
- **Cost** is `ask_messages.cost_usd`, which is the sum of the request's `llm_calls` rows.

| Prompt | Intent | Confidence | Citations | First text | First model text | Total | Cost |
|---|---|---|---|---|---|---|---|
| Should a client bet on mixture-of-agents? | BET | Medium | 6 | 6.1 s | 10.3 s | 19.2 s | $0.0331 |
| Is LLM code review production-ready? | BET | Medium | 6 | 5.5 s | 11.4 s | 20.8 s | $0.0570 |
| Where is industrial computer vision heading? | DIRECTION | Medium | 11 | 5.1 s | 8.8 s | 20.8 s | $0.0355 |
| agentic RAG | EXPLAIN+CATCHUP | Medium | 8 | 5.5 s | 7.7 s | 16.1 s | $0.0177 |
| What's new in RAG since 1 Oct? | CATCHUP | Medium | 6 | 3.2 s | 4.9 s | 8.9 s | $0.0109 |
| Prep me for Acme on vision quality inspection | PREP | Medium | 9 | 3.8 s | 7.3 s | 29.9 s | $0.0638 |

All six answers had the same coverage line: "Searched 1470 indexed papers 2025-09-28 – 2026-10-12". The six together cost $0.2180.

- The PREP answer needed one `ask_repair` call. That call was most of its higher cost.
- "Is LLM code review production-ready?" took three model steps, with two tool rounds, and needed no repair.

This local run used two prompts that are not in `JOB_PROMPTS`: "Is LLM code review production-ready?" instead of the Backing chip, and "Where is industrial computer vision heading?" instead of the Direction chip. The production run above uses the six chips exactly as written.
