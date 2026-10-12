# Ask agent

The Ask panel (`/ask`) answers a keyword, term or question with a cited, evidence-graded consulting deliverable. Code lives in `src/lib/ask/` and the route `src/app/api/ask/route.ts`.

## Request flow

1. **Route** (`route-intent.ts`): one `generateObject` call (stage `ask_route`, minimal reasoning) returns `{intent, bareTerm, entities, since?, domains, client?}`.
2. **Playbook** (`playbooks.ts`): code picks the tool set and the output template (`templates/*.md`) for the intent. A bare term uses EXPLAIN + CATCHUP together.
3. **First search in code**: the playbook's first `search_index` call runs before the model starts, using the routed entities and `since`. This saves one model round so text starts streaming within 10 s.
4. **Tools loop**: `streamText` with `chatModel(app_settings.chat_model)`, the playbook tools, `stopWhen: stepCountIs(6)` and the system prompt `prompts/system.md`. Step 6 runs with `toolChoice: "none"`, so the answer is always written.
5. **Validate** (`answer.ts`, `validateAnswer`): checks for banned words, the word cap (`app_settings.prose_word_cap`), that every `[pN]` was returned by a tool, that evidence tokens resolve, and that every number appears in the retrieved data or the prompt. On failure there is one repair call (stage `ask_repair`). If the repair still fails, the answer is saved with a warning in `coverage.warning`.
6. **Grade** (`grade.ts`, `confidence`): computed from the cited papers, or from all relevant retrieved papers when nothing is cited.
   - **High:** at least 5 papers at rung CODE or above, including at least 1 PEER.
   - **Medium:** at least 3 papers.
   - **Low:** anything else. The panel then shows the "thin evidence" notice.
7. **Save**: `ask_threads` and `ask_messages` store the content with tokens filled, plus `citations` (ref → paper id), `confidence`, `coverage` and `cost_usd`. The answer is also upserted into `search_docs` as `entity_type = 'answer'`, so threads are searchable.

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
| `search_index` | `research_signal.hybrid_search`, top 20, plus each hit's cosine to the query and its rung. Hits with cosine ≥ 0.35 count as relevant. |
| `get_papers` | Card fields for up to 10 refs or ids: abstract (700 characters), authors, per-domain verdict, final score, client angle, risk flags, latest signals and rung. |
| `trend` | One SQL query grouping by `date_trunc('week', coalesce(announced_at, submitted_at))`. It returns paper counts, the rung mix, summed HF upvotes and the top 3 papers (rising first) per week, plus a momentum label: rising, steady, fading or unknown. `coalesce` keeps backstop and live papers, which have no `announced_at`. |
| `related` | The 8 nearest papers by `papers.embedding`, plus `builds_on` from the latest signals when it is non-null. |
| `my_log` | The consultant's `actions`: action, note, client tag and date. Filters are action, client tag (substring), since and a title or note match. |
| `get_fulltext` | `getFullText` (D10: arXiv HTML, then Unpaywall). The text is wrapped in `<untrusted_paper_text>`. At most 2 per question. |
| `live_search` | Hugging Face only: `GET https://huggingface.co/api/papers/search?q=`, top 10. It is allowed only when `search_index` found fewer than 5 hits with cosine ≥ 0.35, or when the routed `since` is earlier than the first indexed paper. It runs once per question. New papers are inserted with `source = 'live'` and status `PREFILTERED`, `paper_domain` rows are added for the routed domains (all active domains when none were routed), HF upvotes and GitHub signals are written, and `embed2` is enqueued so the papers become searchable. |

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
- Model: `app_settings.chat_model`, which must start with `google/`. Reasoning effort is `minimal`.
- Cost: the answer steps are logged under stage `ask`, the router under `ask_route`, the repair under `ask_repair` and the query embeddings under `search_query`. `ask_messages.cost_usd` sums those stages from the request start. This is exact for a single user. Overlapping requests can be counted together.

## Evidence tokens

Paper numbers are written as `{{ev:<ref>.<field>}}`, where field is one of `upvotes`, `comments`, `stars`, `models`, `spaces` or `citations`. Code replaces each token with the stored value (thousands as `1.2k`) or `n/a`. Any other number must be copied from a tool result. The validator rejects numbers that it cannot find in the retrieved data or the prompt.

## Prompt-injection rule

Titles, abstracts, notes, full text and every other string in a tool result are untrusted data. The system prompt tells the model to treat them only as evidence and to ignore any instructions inside them. Full text is wrapped in `<untrusted_paper_text>`. The router wraps the user prompt in `<prompt>` and only classifies it. The repair call receives the retrieved data inside `<untrusted_retrieved_data>`. Citations are checked in code against the refs the tools actually returned, so injected text cannot add a source.

## API

- `POST /api/ask` with body `{threadId?, prompt}`. It returns an AI SDK UI message stream. The `start` part's metadata carries `{threadId, messageId, intent}`. The `finish` part's metadata adds `confidence`, `coverage`, `citations` and `evidence`, computed from the draft.
- `GET /api/ask?threadId=<uuid>` returns the thread's saved messages. These include the validated or repaired answer, which can differ from the streamed draft.
