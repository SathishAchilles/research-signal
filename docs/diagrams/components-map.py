"""Renders docs/diagrams/components-map.svg (swimlane: Trigger -> Input -> Context -> Processing -> AI -> Output).

Format mirrors ~/ws/aangan-frontdesk/docs/diagrams/components-map.py. Boxes are a little narrower
(BOX_W 0.80) so that every edge gets its own track in the gutters between columns, and labels are
placed by hand where several tracks run side by side.
Run from the repo root:
  python3 docs/diagrams/components-map.py
  rsvg-convert -z 1.5 docs/diagrams/components-map.svg -o docs/diagrams/components-map.png
"""
from html import escape
from pathlib import Path

LANE_W = 200
TOP = 118
HEAD_H = 46
COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"]
COL_W = [250, 260, 320, 350, 300, 360]
COL_X = []
x = 20 + LANE_W
for w in COL_W:
    COL_X.append(x)
    x += w
GRID_RIGHT = x

LANES = [
    ("Kavita", "consultant · 8-10 domains", 246),
    ("Vercel app", "Next.js · PIN-gated", 166),
    ("Gemini", "via OpenRouter · google/* only", 246),
    ("Supabase data", "schema research_signal", 246),
    ("Vercel stages", "/api/stage/* · ≤ 300 s", 324),
    ("Supabase cron", "pg_cron + pg_net", 100),
    ("Live sources", "public APIs · rate-limited", 262),
    ("Resend", "email", 100),
]
LANE_Y = {}
y = TOP + HEAD_H
for name, _sub, h in LANES:
    LANE_Y[name] = (y, h)
    y += h
GRID_BOTTOM = y

STYLE = {
    "ai": ("#EEEAFB", "#5B4BB7", "#2B1E73"),
    "out": ("#E4F4EC", "#2E8B62", "#14523A"),
    "esc": ("#FCEBD8", "#C27420", "#6E3D08"),
    "sys": ("#FFFFFF", "#5B6470", "#1F2328"),
    "build": ("#EFEBE3", "#8A8170", "#3D372C"),
    "cut": ("#FDECEC", "#C0392B", "#7B1D14"),
}

BOX_W = 0.80
BOX_H = 58
boxes = {}


def box(key, lane, col, title, sub, kind="sys", slot=None):
    ly, lh = LANE_Y[lane]
    cw = COL_W[col]
    w = cw * BOX_W
    bx = COL_X[col] + (cw - w) / 2
    if slot is None:
        by = ly + (lh - BOX_H) / 2
    else:
        by = ly + 22 + slot * (BOX_H + 20)
    boxes[key] = dict(x=bx, y=by, w=w, h=BOX_H, title=title, sub=sub, kind=kind)


def ly_(lane, d=0.0):
    return LANE_Y[lane][0] + d


def lbottom(lane, d=0.0):
    a, h = LANE_Y[lane]
    return a + h + d


# ---- boxes -------------------------------------------------------------------------------
# Kavita
box("prompt", "Kavita", 0, "Search / Ask (Cmd-K)", "keyword · term · question", slot=0)
box("click", "Kavita", 0, "Read · Client · Skip", "one click, email or web", slot=1)
box("edit", "Kavita", 0, "Edits Settings", "domains · sources · delivery", slot=2)
box("pin", "Kavita", 1, "6-digit PIN", "argon2id · per-IP backoff", slot=0)
box("cut_alerts", "Kavita", 2, "CUT: real-time alerts", "weekly brief + on-demand Ask", "cut", slot=2)
box("brief", "Kavita", 5, "Reads the Monday brief", "07:00 IST · by domain · < 10 min", "out", slot=0)
box("answer", "Kavita", 5, "Cited client answer", "6 intents · High / Med / Low", "out", slot=1)
box("loglist", "Kavita", 5, "Notable log · CSV", "client tags · notes · for the deck", "out", slot=2)
# Vercel app
box("search", "Vercel app", 3, "Hybrid search", "FTS + vector (RRF) · facets · presets", slot=0)
box("ask", "Vercel app", 4, "Ask agent", "route → 7 tools → grade → cite", "ai", slot=0)
box("web", "Vercel app", 5, "Web brief + archive", "hero · standard · compact · j/k", "out", slot=0)
box("health", "Vercel app", 5, "Settings: health + cost", "sources · scheduler · spend", "out", slot=1)
# Gemini
box("embed", "Gemini", 4, "Embed 2-pass · 768d", "title+1st sentence → abstract", "ai", slot=0)
box("score", "Gemini", 4, "Score 25 papers / call", "signal type · novelty · client angle", "ai", slot=1)
box("compose", "Gemini", 4, "Rerank 15 + compose", "Sun · BLUF · S-C-I · Smart Brevity", "ai", slot=2)
box("credits", "Gemini", 5, "Credits out (402)", "template text · flagged red", "esc", slot=2)
# Supabase data
box("domains", "Supabase data", 2, "Domains + sources", "editable · keys in Vault", slot=0)
box("papers", "Supabase data", 2, "Papers · signals · evidence", "rung LAB → PEER · rising", slot=1)
box("index", "Supabase data", 2, "search_docs index", "FTS + halfvec(768) HNSW", slot=2)
box("actions", "Supabase data", 3, "Actions + cost log", "notable log · llm_calls · runs", slot=1)
# Vercel stages
box("hb", "Vercel stages", 0, "Vercel Cron heartbeat", "if idle 26 h · flags stale", slot=1)
box("ingest", "Vercel stages", 3, "ingest → job queue", "upsert · dedupe · arXiv lease", slot=0)
box("rank", "Vercel stages", 3, "rank (code) → finalists", "Flash scores + signals · top 10", slot=1)
box("enrich", "Vercel stages", 3, "enrich finalists", "signals rows · then re-rank", slot=2)
box("weekly", "Vercel stages", 3, "weekly: select · validate", "tiers · tokens · caps · < 90 KB", slot=3)
# Supabase cron
box("cron", "Supabase cron", 0, "pg_cron: 6 rs_* jobs", "ingest·drain·hf·weekly·retention")
# Live sources
box("arxiv", "Live sources", 1, "arXiv RSS + API", "new + cross · 1 req / 3 s", slot=0)
box("hf", "Live sources", 1, "Hugging Face Papers", "upvotes · code · models", slot=1)
box("venues", "Live sources", 1, "ACL · CVF · PMLR", "weekly diff · venue = PEER", slot=2)
box("openrev", "Live sources", 2, "OpenReview", "title match · best-effort", slot=0)
box("s2", "Live sources", 2, "Semantic Scholar", "keyless batch · builds-on", slot=1)
box("fulltext", "Live sources", 2, "Full text", "arXiv HTML · Unpaywall · CORE off", slot=2)
box("cut_oa", "Live sources", 4, "CUT: OpenAlex", "wrong works for arXiv DOIs", "cut", slot=1)
box("srcdown", "Live sources", 5, "Source down → footer", "ingest/enrich fail · still sends", "esc", slot=1)
# Resend
box("email", "Resend", 5, "Email, Mon 07:00 IST", "scheduledAt · to Resend owner", "out")


def A(key, side, d=0.0):
    b = boxes[key]
    if side == "r":
        return (b["x"] + b["w"], b["y"] + b["h"] / 2 + d)
    if side == "l":
        return (b["x"], b["y"] + b["h"] / 2 + d)
    if side == "t":
        return (b["x"] + b["w"] / 2 + d, b["y"])
    return (b["x"] + b["w"] / 2 + d, b["y"] + b["h"])


def cy(key, d=0.0):
    b = boxes[key]
    return b["y"] + b["h"] / 2 + d


def cx(key, d=0.0):
    b = boxes[key]
    return b["x"] + b["w"] / 2 + d


def top(key):
    return boxes[key]["y"]


def bot(key):
    return boxes[key]["y"] + boxes[key]["h"]


def gutter(left_col, k):
    """x of track k in the gutter between column left_col and left_col+1 (12 px from the left box, 12 px apart)."""
    right_edge = COL_X[left_col] + COL_W[left_col] * (1 + BOX_W) / 2
    return right_edge + 12 + 12 * k


TI = lambda k: gutter(0, k)  # Trigger | Input
IC = lambda k: gutter(1, k)  # Input | Context
CP = lambda k: gutter(2, k)  # Context | Processing
PA = lambda k: gutter(3, k)  # Processing | AI
AO = lambda k: gutter(4, k)  # AI | Output
R = GRID_RIGHT
ORANGE = "#C27420"
edges = []  # (points, label, at, dashed, color)


def E(points, label="", at=None, dashed=False, color="#3A3F45"):
    edges.append((points, label, at, dashed, color))


# ---- interactive path ----------------------------------------------------------------------
E([A("prompt", "r"), A("pin", "l")])
E([A("pin", "r", -10), (cx("ask"), cy("pin", -10)), A("ask", "t")], "ask", (1260, cy("pin", -10)))
E([A("pin", "r", 10), (CP(0), cy("pin", 10)), (CP(0), cy("search")), A("search", "l")], "search", (880, cy("pin", 10)))
E([A("ask", "l"), A("search", "r")], "tools", ((A("search", "r")[0] + A("ask", "l")[0]) / 2, cy("search")))
E([A("search", "b"), (cx("search"), bot("search") + 14), (CP(1), bot("search") + 14), (CP(1), cy("index")), A("index", "r")],
  "hybrid query", (1170, bot("search") + 14))
E([A("ask", "t", 80), (cx("ask", 80), cy("answer")), A("answer", "l")], "cited", (cx("ask", 80), cy("loglist", 2)))
E([A("ask", "b", 60), (cx("ask", 60), bot("ask") + 14), (AO(3), bot("ask") + 14), (AO(3), ly_("Live sources", 11)),
   (IC(2), ly_("Live sources", 11)), (IC(2), cy("hf", -14)), A("hf", "r", -14)],
  "live_search: Hugging Face only", (1250, ly_("Live sources", 11)), dashed=True)
E([A("click", "r"), (CP(2), cy("click")), (CP(2), cy("actions", -14)), A("actions", "l", -14)], "actions · signed email links", (600, cy("click")))
E([A("edit", "b"), (cx("edit"), cy("domains")), A("domains", "l")], "edits, no redeploy", (cx("edit"), ly_("Gemini", 118)))
E([A("actions", "r"), (AO(1), cy("actions")), (AO(1), cy("loglist")), A("loglist", "l")])
E([A("actions", "t"), (cx("actions"), cy("domains")), A("domains", "r")], "CLIENT flags tune", (cx("actions"), cy("domains")), dashed=True)
E([A("actions", "r", 14), (AO(2), cy("actions", 14)), (AO(2), cy("health")), A("health", "l")], dashed=True)

# ---- scheduled pipeline ----------------------------------------------------------------------
E([A("cron", "r"), (TI(2), cy("cron")), (TI(2), cy("ingest", -14)), A("ingest", "l", -14)], "rs_ingest 08:00 · drain every 3 min", (900, cy("ingest", -14)))
E([A("hb", "r"), (TI(1), cy("hb")), (TI(1), cy("ingest")), A("ingest", "l")], "drain if idle", (540, cy("ingest")), dashed=True)
E([A("arxiv", "t"), (cx("arxiv"), cy("ingest", 14)), A("ingest", "l", 14)], "new + cross", (cx("arxiv"), cy("cron")))
E([A("hf", "r"), (IC(1), cy("hf")), (IC(1), ly_("Vercel stages", 11)), (cx("ingest", -60), ly_("Vercel stages", 11)), A("ingest", "t", -60)],
  "HF daily × 3 dates", (900, ly_("Vercel stages", 11)))
E([A("hf", "r", 14), (IC(0), cy("hf", 14)), (IC(0), lbottom("Live sources", -9)), (CP(3), lbottom("Live sources", -9)),
   (CP(3), cy("enrich", 14)), A("enrich", "l", 14)], "HF detail (shortlist)", (900, lbottom("Live sources", -9)))
E([A("openrev", "r"), (CP(0), cy("openrev")), (CP(0), cy("enrich", -14)), A("enrich", "l", -14)])
E([A("s2", "r"), (CP(1), cy("s2")), (CP(1), cy("enrich")), A("enrich", "l")])
E([A("fulltext", "r"), (CP(2), cy("fulltext")), (CP(2), cy("weekly", 14)), A("weekly", "l", 14)])
E([A("venues", "l"), (TI(0), cy("venues")), (TI(0), cy("weekly", -14)), A("weekly", "l", -14)], "venue papers · PEER", (900, cy("weekly", -14)))
E([A("cron", "t"), (cx("cron"), cy("weekly")), A("weekly", "l")], "rs_weekly Sun 17:30 · retry", (660, cy("weekly")))
E([A("ingest", "r"), (PA(0), cy("ingest")), (PA(0), cy("embed", 10)), A("embed", "l", 10)])
E([A("domains", "t"), (cx("domains"), cy("embed", -10)), A("embed", "l", -10)], "centroids", (1230, cy("embed", -10)), dashed=True)
E([A("embed", "b"), A("score", "t")], "top 40 / domain", (cx("embed", 72), (bot("embed") + top("score")) / 2))
E([A("score", "l"), (PA(1), cy("score")), (PA(1), cy("rank", -12)), A("rank", "r", -12)])
E([A("rank", "b"), A("enrich", "t")])
E([A("enrich", "r"), (PA(2), cy("enrich")), (PA(2), cy("rank", 12)), A("rank", "r", 12)], dashed=True)
E([A("weekly", "r", -14), (PA(3), cy("weekly", -14)), (PA(3), cy("compose")), A("compose", "l")])
E([A("compose", "b"), (cx("compose"), cy("weekly")), A("weekly", "r")], "prose", (cx("compose"), ly_("Supabase data", 199)), dashed=True)
E([A("weekly", "r", 14), (AO(2), cy("weekly", 14)), (AO(2), cy("email")), A("email", "l")], "render · scheduledAt", (1462, cy("weekly", 14)))
E([A("weekly", "r", 26), (AO(4), cy("weekly", 26)), (AO(4), cy("web", 16)), A("web", "l", 16)], "publish", (1602, cy("weekly", 26)))
E([A("rank", "l"), (CP(4), cy("rank")), (CP(4), cy("papers", 14)), A("papers", "r", 14)], "writes", (CP(4) + 6, cy("index", 6)))
E([A("papers", "b"), A("index", "t")], "indexed", (cx("papers", 62), (bot("papers") + top("index")) / 2))
E([A("enrich", "r", 14), (AO(1), cy("enrich", 14)), (AO(1), cy("srcdown")), A("srcdown", "l")], "source down", (1560, cy("enrich", 14)), dashed=True, color=ORANGE)
E([A("compose", "r"), A("credits", "l")], dashed=True, color=ORANGE)
E([A("email", "r"), (R + 18, cy("email")), (R + 18, cy("brief", 10)), A("brief", "r", 10)], "Mon 07:00 IST", (R + 18, ly_("Supabase data", 60)), dashed=True)
E([A("web", "r"), (R + 44, cy("web")), (R + 44, cy("brief", -10)), A("brief", "r", -10)], "web", (R + 44, cy("answer")), dashed=True)

# ---- render ----------------------------------------------------------------------------------
out = []
H = GRID_BOTTOM + 276
W = GRID_RIGHT + 130
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Helvetica, Arial, sans-serif">')
out.append('<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3A3F45"/></marker>'
           '<marker id="arrOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#C27420"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')
out.append('<text x="20" y="48" font-size="30" font-weight="700" fill="#1F2328">research-signal · Weekly research brief components map</text>')
out.append('<text x="20" y="80" font-size="16" fill="#5B6470">Monday 07:00 IST brief by domain · Gemini via OpenRouter only (Google infra) · domains and sources editable without code · numbers computed in code, never by the LLM</text>')

out.append(f'<rect x="20" y="{TOP}" width="{GRID_RIGHT - 20}" height="{HEAD_H}" fill="#2D3A45"/>')
out.append(f'<text x="{20 + LANE_W / 2}" y="{TOP + 30}" font-size="18" font-weight="700" fill="#FFFFFF" text-anchor="middle">Lane</text>')
for i, name in enumerate(COLS):
    out.append(f'<text x="{COL_X[i] + COL_W[i] / 2}" y="{TOP + 30}" font-size="18" font-weight="700" fill="#FFFFFF" text-anchor="middle">{name}</text>')

for i, (name, sub, h) in enumerate(LANES):
    ly, lh = LANE_Y[name]
    out.append(f'<rect x="{20 + LANE_W}" y="{ly}" width="{GRID_RIGHT - 20 - LANE_W}" height="{lh}" fill="{"#F5F7F9" if i % 2 == 0 else "#EDF0F3"}"/>')
    out.append(f'<rect x="20" y="{ly}" width="{LANE_W}" height="{lh}" fill="#E1E6EB"/>')
    out.append(f'<text x="{20 + LANE_W / 2}" y="{ly + lh / 2 - 2}" font-size="17" font-weight="700" fill="#1F2328" text-anchor="middle">{escape(name)}</text>')
    out.append(f'<text x="{20 + LANE_W / 2}" y="{ly + lh / 2 + 18}" font-size="13" fill="#5B6470" text-anchor="middle">{escape(sub)}</text>')
    out.append(f'<line x1="20" y1="{ly}" x2="{GRID_RIGHT}" y2="{ly}" stroke="#D3D9DF"/>')
for cxl in COL_X[1:]:
    out.append(f'<line x1="{cxl}" y1="{TOP + HEAD_H}" x2="{cxl}" y2="{GRID_BOTTOM}" stroke="#C9D0D6" stroke-dasharray="4 5"/>')
out.append(f'<rect x="20" y="{TOP}" width="{GRID_RIGHT - 20}" height="{GRID_BOTTOM - TOP}" fill="none" stroke="#C9D0D6"/>')

labels = []
for pts, label, at, dashed, color in edges:
    d = "M" + " L".join(f"{px:.1f},{py:.1f}" for px, py in pts)
    marker = "arrOrange" if color == ORANGE else "arr"
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.8"{dash} marker-end="url(#{marker})"/>')
    if label:
        if at is None:
            (x1, y1), (x2, y2) = pts[0], pts[1]
            at = ((x1 + x2) / 2, (y1 + y2) / 2)
        labels.append((at[0], at[1], label, color))

for key, b in boxes.items():
    fill, stroke, ink = STYLE[b["kind"]]
    dash = ' stroke-dasharray="7 4"' if b["kind"] == "cut" else ""
    out.append(f'<rect x="{b["x"]:.1f}" y="{b["y"]:.1f}" width="{b["w"]:.1f}" height="{b["h"]}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="{2.2 if b["kind"] == "cut" else 1.6}"{dash}/>')
    out.append(f'<text x="{b["x"] + b["w"] / 2:.1f}" y="{b["y"] + 24:.1f}" font-size="15.5" font-weight="700" fill="{ink}" text-anchor="middle">{escape(b["title"])}</text>')
    out.append(f'<text x="{b["x"] + b["w"] / 2:.1f}" y="{b["y"] + 44:.1f}" font-size="12.5" fill="{stroke}" text-anchor="middle">{escape(b["sub"])}</text>')

for lx, ly, label, color in labels:
    width = 7.2 * len(label) + 12
    out.append(f'<rect x="{lx - width / 2:.1f}" y="{ly - 10:.1f}" width="{width:.1f}" height="19" rx="4" fill="#FFFFFF" stroke="#D3D9DF" stroke-width="0.8"/>')
    out.append(f'<text x="{lx:.1f}" y="{ly + 4:.1f}" font-size="12.5" font-weight="600" fill="{color}" text-anchor="middle">{escape(label)}</text>')

# build strip (migrations before deploy; cron jobs only after /api/health is OK)
by = GRID_BOTTOM + 22
out.append(f'<rect x="20" y="{by}" width="{GRID_RIGHT - 20}" height="70" fill="#F7F4EF" stroke="#D8D1C4"/>')
out.append(f'<text x="{20 + LANE_W / 2}" y="{by + 32}" font-size="17" font-weight="700" fill="#3D372C" text-anchor="middle">GitHub</text>')
out.append(f'<text x="{20 + LANE_W / 2}" y="{by + 52}" font-size="13" fill="#5B6470" text-anchor="middle">build only, not runtime</text>')
strip = [("Code · prompts · OpenSpec plan", 255), ("SQL 001-004 · schema + RLS", 712), ("Deploy to Vercel (sin1)", 1169), ("/api/health OK → 005 rs_* cron", 1626)]
for i, (text, sx) in enumerate(strip):
    out.append(f'<rect x="{sx}" y="{by + 14}" width="380" height="42" rx="8" fill="#EFEBE3" stroke="#8A8170"/>')
    out.append(f'<text x="{sx + 190}" y="{by + 40}" font-size="14" font-weight="600" fill="#3D372C" text-anchor="middle">{escape(text)}</text>')
    if i < len(strip) - 1:
        out.append(f'<path d="M{sx + 380},{by + 35} L{strip[i + 1][1]},{by + 35}" stroke="#8A8170" stroke-width="1.8" marker-end="url(#arr)"/>')

ly = by + 100
items = [("ai", "AI step"), ("out", "Output"), ("esc", "Fallback / degraded"), ("sys", "System step"), ("build", "Build / deploy"), ("cut", "The Cut (removed)")]
lx = 20
for kind, label in items:
    fill, stroke, _ink = STYLE[kind]
    out.append(f'<rect x="{lx}" y="{ly}" width="22" height="16" rx="4" fill="{fill}" stroke="{stroke}"{" stroke-dasharray=\"4 3\"" if kind == "cut" else ""}/>')
    out.append(f'<text x="{lx + 30}" y="{ly + 13}" font-size="14" fill="#1F2328">{label}</text>')
    lx += 60 + 8.4 * len(label)
out.append(f'<path d="M{lx + 10},{ly + 8} L{lx + 50},{ly + 8}" stroke="#3A3F45" stroke-width="1.8" stroke-dasharray="6 5" marker-end="url(#arr)"/>')
out.append(f'<text x="{lx + 58}" y="{ly + 13}" font-size="14" fill="#1F2328">Asynchronous</text>')
notes = [
    "The Cut: OpenAlex (returned the wrong works for arXiv DOIs in testing) and real-time alerts (the Monday brief plus on-demand Search/Ask cover the need without noise).",
    "Evidence ladder: LAB → CODE (GitHub repo) → MODEL (HF models / Spaces) → PEER (OpenReview accepted, ACL / CVF / PMLR, or a non-arXiv S2 venue). Final = 0.35 relevance + 0.30 significance + 0.20 attention + 0.15 validation.",
    "Timing: ~60 s/day of source fetching, ~2 min/day pipeline, ~110 s on Sunday; each stage capped at 240 s of work (300 s max). Brief covers Mon-Fri announcements and is pre-scheduled in Resend.",
    "Semantic Scholar runs keyless: one best-effort batch per enrich run (failure = PARTIAL, footer note); no S2 search. Ask tools: search_index, get_papers, trend, related, my_log, get_fulltext, live_search.",
    "Email: onboarding@resend.dev delivers only to the Resend account owner (sathish_babu@pg27.mesaschool.co); any other recipient needs a verified sending domain.",
]
for i, note in enumerate(notes):
    out.append(f'<text x="20" y="{ly + 44 + i * 22}" font-size="14" fill="#3A3F45">{escape(note)}</text>')
out.append("</svg>")

# Resolved from this file (repo/docs/diagrams/), so the output lands in docs/diagrams/ from any cwd.
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "docs" / "diagrams" / "components-map.svg"
OUT.write_text("\n".join(out) + "\n")
print("wrote", OUT.relative_to(REPO_ROOT))
