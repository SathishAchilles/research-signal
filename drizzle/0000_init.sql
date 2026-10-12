CREATE TYPE "research_signal"."action_kind" AS ENUM('READ', 'CLIENT', 'SKIP');--> statement-breakpoint
CREATE TYPE "research_signal"."action_origin" AS ENUM('email', 'web', 'ask');--> statement-breakpoint
CREATE TYPE "research_signal"."brief_status" AS ENUM('DRAFT', 'READY', 'SCHEDULED', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "research_signal"."brief_tier" AS ENUM('TOP3', 'HERO', 'STANDARD', 'COMPACT', 'RISING');--> statement-breakpoint
CREATE TYPE "research_signal"."entity_type" AS ENUM('paper', 'summary', 'note', 'brief', 'answer');--> statement-breakpoint
CREATE TYPE "research_signal"."job_stage" AS ENUM('embed1', 'embed2', 'score', 'enrich', 'hf_refresh', 'weekly');--> statement-breakpoint
CREATE TYPE "research_signal"."job_status" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "research_signal"."paper_status" AS ENUM('NEW', 'PREFILTERED', 'SHORTLISTED', 'SCORED', 'FINALIST', 'SENT', 'DROPPED');--> statement-breakpoint
CREATE TYPE "research_signal"."run_status" AS ENUM('OK', 'PARTIAL', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "research_signal"."rung" AS ENUM('LAB', 'CODE', 'MODEL', 'PEER');--> statement-breakpoint
CREATE TYPE "research_signal"."signal_type" AS ENUM('BENCH', 'EVAL', 'REFRAME', 'METHOD');--> statement-breakpoint
CREATE TYPE "research_signal"."source_kind" AS ENUM('arxiv', 'hf', 'openreview', 's2', 'acl', 'cvf', 'pmlr', 'unpaywall', 'core');--> statement-breakpoint
CREATE TYPE "research_signal"."source_role" AS ENUM('discover', 'attention', 'validation', 'enrich', 'fulltext');--> statement-breakpoint
CREATE TYPE "research_signal"."verdict" AS ENUM('READ', 'CLIENT', 'SKIP');--> statement-breakpoint
CREATE TABLE "research_signal"."actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_signal"."actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"paper_id" uuid NOT NULL,
	"action" "research_signal"."action_kind" NOT NULL,
	"note" text,
	"client_tag" text,
	"origin" "research_signal"."action_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signal"."app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"pin_hash" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"send_local_time" text DEFAULT '07:00' NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"chat_model" text DEFAULT 'google/gemini-3.7-flash' NOT NULL,
	"embed_model" text DEFAULT 'google/gemini-embedding-001' NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prose_word_cap" integer DEFAULT 1500 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("research_signal"."app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "research_signal"."ask_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"citations" jsonb,
	"confidence" text,
	"coverage" jsonb,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signal"."ask_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signal"."auth_attempts" (
	"ip" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"lockouts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signal"."brief_items" (
	"brief_id" uuid NOT NULL,
	"paper_id" uuid NOT NULL,
	"domain_id" integer,
	"tier" "research_signal"."brief_tier" NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "brief_items_brief_id_paper_id_tier_pk" PRIMARY KEY("brief_id","paper_id","tier")
);
--> statement-breakpoint
CREATE TABLE "research_signal"."briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso_week" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"status" "research_signal"."brief_status" DEFAULT 'DRAFT' NOT NULL,
	"json" jsonb,
	"html" text,
	"html_bytes" integer,
	"resend_id" text,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "briefs_iso_week_unique" UNIQUE("iso_week")
);
--> statement-breakpoint
CREATE TABLE "research_signal"."domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"excludes" text[] DEFAULT '{}'::text[] NOT NULL,
	"arxiv_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"venues" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"centroid" halfvec(768),
	"centroid_updated_at" timestamp with time zone,
	CONSTRAINT "domains_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "research_signal"."jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_signal"."jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stage" "research_signal"."job_stage" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "research_signal"."job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "research_signal"."leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signal"."llm_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_signal"."llm_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" double precision,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signal"."paper_domain" (
	"paper_id" uuid NOT NULL,
	"domain_id" integer NOT NULL,
	"cosine" real,
	"llm_relevance" smallint,
	"novelty" smallint,
	"signal_type" "research_signal"."signal_type",
	"client_angle" text,
	"risk_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"final_score" real,
	"verdict" "research_signal"."verdict",
	"scored_at" timestamp with time zone,
	CONSTRAINT "paper_domain_paper_id_domain_id_pk" PRIMARY KEY("paper_id","domain_id")
);
--> statement-breakpoint
CREATE TABLE "research_signal"."papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arxiv_id" text,
	"doi" text,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"abstract" text DEFAULT '' NOT NULL,
	"authors" text[] DEFAULT '{}'::text[] NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"submitted_at" timestamp with time zone,
	"announced_at" timestamp with time zone,
	"url_abs" text,
	"url_pdf" text,
	"url_html" text,
	"status" "research_signal"."paper_status" DEFAULT 'NEW' NOT NULL,
	"embedding" halfvec(768),
	"fts" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')),'A') || setweight(to_tsvector('english', coalesce(abstract,'')),'B')) STORED,
	"title_norm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "papers_arxiv_id_unique" UNIQUE("arxiv_id"),
	CONSTRAINT "papers_doi_unique" UNIQUE("doi")
);
--> statement-breakpoint
CREATE TABLE "research_signal"."search_docs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_signal"."search_docs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" "research_signal"."entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"paper_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"fts" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title,'')),'A') || setweight(to_tsvector('english', coalesce(body,'')),'B')) STORED,
	"embedding" halfvec(768),
	"domain_ids" integer[] DEFAULT '{}'::int[] NOT NULL,
	"source" text,
	"rung" "research_signal"."rung",
	"venue_status" text,
	"user_action" "research_signal"."action_kind",
	"has_code" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"attention" real,
	"content_hash" text,
	CONSTRAINT "search_docs_entity_unique" UNIQUE("entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "research_signal"."signals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_signal"."signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"paper_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hf_upvotes" integer,
	"hf_comments" integer,
	"github_repo" text,
	"github_stars" integer,
	"linked_models" integer,
	"linked_spaces" integer,
	"or_venue" text,
	"or_decision" text,
	"s2_citations" integer,
	"builds_on" jsonb,
	"venue" text
);
--> statement-breakpoint
CREATE TABLE "research_signal"."source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_kind" text,
	"stage" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "research_signal"."run_status",
	"items" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "research_signal"."sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "research_signal"."source_kind" NOT NULL,
	"role" "research_signal"."source_role" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_name" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" "research_signal"."run_status",
	"last_error" text,
	"last_item_count" integer,
	"etag" text,
	"last_modified" text,
	"cursor" jsonb,
	CONSTRAINT "sources_kind_unique" UNIQUE("kind")
);
--> statement-breakpoint
ALTER TABLE "research_signal"."actions" ADD CONSTRAINT "actions_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "research_signal"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."ask_messages" ADD CONSTRAINT "ask_messages_thread_id_ask_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "research_signal"."ask_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."brief_items" ADD CONSTRAINT "brief_items_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "research_signal"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."brief_items" ADD CONSTRAINT "brief_items_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "research_signal"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."brief_items" ADD CONSTRAINT "brief_items_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "research_signal"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."paper_domain" ADD CONSTRAINT "paper_domain_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "research_signal"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."paper_domain" ADD CONSTRAINT "paper_domain_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "research_signal"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."search_docs" ADD CONSTRAINT "search_docs_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "research_signal"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signal"."signals" ADD CONSTRAINT "signals_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "research_signal"."papers"("id") ON DELETE cascade ON UPDATE no action;
