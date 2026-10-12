import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const rs = pgSchema("research_signal");

export const halfvec768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "halfvec(768)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number);
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const sourceKind = rs.enum("source_kind", [
  "arxiv",
  "hf",
  "openreview",
  "s2",
  "acl",
  "cvf",
  "pmlr",
  "unpaywall",
  "core",
]);
export const sourceRole = rs.enum("source_role", [
  "discover",
  "attention",
  "validation",
  "enrich",
  "fulltext",
]);
export const paperStatus = rs.enum("paper_status", [
  "NEW",
  "PREFILTERED",
  "SHORTLISTED",
  "SCORED",
  "FINALIST",
  "SENT",
  "DROPPED",
]);
export const signalType = rs.enum("signal_type", ["BENCH", "EVAL", "REFRAME", "METHOD"]);
export const verdict = rs.enum("verdict", ["READ", "CLIENT", "SKIP"]);
// Ordered weakest to strongest so that `rung >= 'CODE'` compares as expected.
export const rung = rs.enum("rung", ["LAB", "CODE", "MODEL", "PEER"]);
export const briefStatus = rs.enum("brief_status", ["DRAFT", "READY", "SCHEDULED", "SENT", "FAILED"]);
export const briefTier = rs.enum("brief_tier", ["TOP3", "HERO", "STANDARD", "COMPACT", "RISING"]);
export const actionKind = rs.enum("action_kind", ["READ", "CLIENT", "SKIP"]);
export const actionOrigin = rs.enum("action_origin", ["email", "web", "ask"]);
export const entityType = rs.enum("entity_type", ["paper", "summary", "note", "brief", "answer"]);
export const jobStage = rs.enum("job_stage", ["embed1", "embed2", "score", "enrich", "figures", "hf_refresh", "weekly"]);
export const jobStatus = rs.enum("job_status", ["PENDING", "RUNNING", "DONE", "FAILED"]);
export const runStatus = rs.enum("run_status", ["OK", "PARTIAL", "FAILED", "SKIPPED"]);

export const appSettings = rs.table(
  "app_settings",
  {
    id: smallint("id").primaryKey().default(1),
    pinHash: text("pin_hash"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    sendLocalTime: text("send_local_time").notNull().default("07:00"),
    recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
    chatModel: text("chat_model").notNull().default("google/gemini-3.7-flash"),
    embedModel: text("embed_model").notNull().default("google/gemini-embedding-001"),
    thresholds: jsonb("thresholds").$type<Record<string, number>>().notNull().default({}),
    weights: jsonb("weights").$type<Record<string, number>>().notNull().default({}),
    proseWordCap: integer("prose_word_cap").notNull().default(1500),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [check("app_settings_singleton", sql`${t.id} = 1`)],
);

export const domains = rs.table("domains", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  keywords: text("keywords").array().notNull().default(sql`'{}'::text[]`),
  excludes: text("excludes").array().notNull().default(sql`'{}'::text[]`),
  arxivCategories: text("arxiv_categories").array().notNull().default(sql`'{}'::text[]`),
  venues: text("venues").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  centroid: halfvec768("centroid"),
  centroidUpdatedAt: timestamptz("centroid_updated_at"),
});

export const sources = rs.table("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: sourceKind("kind").notNull().unique(),
  role: sourceRole("role").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  secretName: text("secret_name"),
  priority: integer("priority").notNull().default(100),
  lastRunAt: timestamptz("last_run_at"),
  lastStatus: runStatus("last_status"),
  lastError: text("last_error"),
  lastItemCount: integer("last_item_count"),
  etag: text("etag"),
  lastModified: text("last_modified"),
  cursor: jsonb("cursor").$type<Record<string, unknown>>(),
});

export const papers = rs.table("papers", {
  id: uuid("id").primaryKey().defaultRandom(),
  arxivId: text("arxiv_id").unique(),
  doi: text("doi").unique(),
  source: text("source").notNull(),
  title: text("title").notNull(),
  abstract: text("abstract").notNull().default(""),
  authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
  categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
  submittedAt: timestamptz("submitted_at"),
  announcedAt: timestamptz("announced_at"),
  urlAbs: text("url_abs"),
  urlPdf: text("url_pdf"),
  urlHtml: text("url_html"),
  status: paperStatus("status").notNull().default("NEW"),
  embedding: halfvec768("embedding"),
  fts: tsvector("fts").generatedAlwaysAs(
    sql`setweight(to_tsvector('english', coalesce(title,'')),'A') || setweight(to_tsvector('english', coalesce(abstract,'')),'B')`,
  ),
  titleNorm: text("title_norm").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  figureUrl: text("figure_url"),
  figureSource: text("figure_source").$type<"hf_media" | "arxiv_html" | "hf_thumb">(),
  figures: jsonb("figures").$type<{ url: string; caption: string }[]>(),
});

export const paperDomain = rs.table(
  "paper_domain",
  {
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    domainId: integer("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    cosine: real("cosine"),
    llmRelevance: smallint("llm_relevance"),
    novelty: smallint("novelty"),
    signalType: signalType("signal_type"),
    clientAngle: text("client_angle"),
    riskFlags: text("risk_flags").array().notNull().default(sql`'{}'::text[]`),
    finalScore: real("final_score"),
    verdict: verdict("verdict"),
    scoredAt: timestamptz("scored_at"),
  },
  (t) => [primaryKey({ columns: [t.paperId, t.domainId] })],
);

export const signals = rs.table("signals", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  paperId: uuid("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  capturedAt: timestamptz("captured_at").notNull().defaultNow(),
  hfUpvotes: integer("hf_upvotes"),
  hfComments: integer("hf_comments"),
  githubRepo: text("github_repo"),
  githubStars: integer("github_stars"),
  linkedModels: integer("linked_models"),
  linkedSpaces: integer("linked_spaces"),
  orVenue: text("or_venue"),
  orDecision: text("or_decision"),
  s2Citations: integer("s2_citations"),
  buildsOn: jsonb("builds_on"),
  venue: text("venue"),
});

export const briefs = rs.table("briefs", {
  id: uuid("id").primaryKey().defaultRandom(),
  isoWeek: text("iso_week").notNull().unique(),
  windowStart: timestamptz("window_start").notNull(),
  windowEnd: timestamptz("window_end").notNull(),
  status: briefStatus("status").notNull().default("DRAFT"),
  json: jsonb("json"),
  html: text("html"),
  htmlBytes: integer("html_bytes"),
  resendId: text("resend_id"),
  scheduledFor: timestamptz("scheduled_for"),
  sentAt: timestamptz("sent_at"),
});

export const briefItems = rs.table(
  "brief_items",
  {
    briefId: uuid("brief_id")
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    domainId: integer("domain_id").references(() => domains.id, { onDelete: "set null" }),
    tier: briefTier("tier").notNull(),
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.briefId, t.paperId, t.tier] })],
);

export const actions = rs.table("actions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  paperId: uuid("paper_id")
    .notNull()
    .references(() => papers.id, { onDelete: "cascade" }),
  action: actionKind("action").notNull(),
  note: text("note"),
  clientTag: text("client_tag"),
  origin: actionOrigin("origin").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const searchDocs = rs.table(
  "search_docs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    paperId: uuid("paper_id").references(() => papers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    fts: tsvector("fts").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title,'')),'A') || setweight(to_tsvector('english', coalesce(body,'')),'B')`,
    ),
    embedding: halfvec768("embedding"),
    domainIds: integer("domain_ids").array().notNull().default(sql`'{}'::int[]`),
    source: text("source"),
    rung: rung("rung"),
    venueStatus: text("venue_status"),
    userAction: actionKind("user_action"),
    hasCode: boolean("has_code").notNull().default(false),
    publishedAt: timestamptz("published_at"),
    attention: real("attention"),
    contentHash: text("content_hash"),
  },
  (t) => [unique("search_docs_entity_unique").on(t.entityType, t.entityId)],
);

export const askThreads = rs.table("ask_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const askMessages = rs.table("ask_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => askThreads.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  intent: text("intent"),
  citations: jsonb("citations"),
  confidence: text("confidence"),
  coverage: jsonb("coverage"),
  costUsd: doublePrecision("cost_usd"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const jobs = rs.table("jobs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  stage: jobStage("stage").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: jobStatus("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  runAfter: timestamptz("run_after").notNull().defaultNow(),
  lockedUntil: timestamptz("locked_until"),
});

export const leases = rs.table("leases", {
  name: text("name").primaryKey(),
  holder: text("holder").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
});

export const sourceRuns = rs.table("source_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKind: text("source_kind"),
  stage: text("stage").notNull(),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  finishedAt: timestamptz("finished_at"),
  status: runStatus("status"),
  items: integer("items"),
  error: text("error"),
});

export const llmCalls = rs.table("llm_calls", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  stage: text("stage").notNull(),
  model: text("model").notNull(),
  provider: text("provider"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  costUsd: doublePrecision("cost_usd"),
  status: text("status").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const authAttempts = rs.table("auth_attempts", {
  ip: text("ip").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockouts: integer("lockouts").notNull().default(0),
  lockedUntil: timestamptz("locked_until"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});
