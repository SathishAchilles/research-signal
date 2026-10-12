// Inserts the settings row, the starting domains and the nine sources. Usage: npm run seed
// Insert-only: a row that already exists is left untouched, so re-running never resets values
// changed in Settings. pin_hash and run state are never written here.
import postgres from "postgres";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");

const sql = postgres(url, { max: 1, onnotice: () => {} });

const thresholds = { prefilter_floor: 0.2, hero: 0.6, standard: 0.5, compact: 0.4, client: 0.7, read: 0.5 };
const weights = { relevance: 0.35, significance: 0.3, attention: 0.2, validation: 0.15 };
const recipients = ["sathish_babu@pg27.mesaschool.co"];

const domains = [
  {
    name: "AI agents",
    description: "autonomous LLM agents, tool use, planning, multi-agent systems, agent evaluation",
  },
  {
    name: "Retrieval-augmented generation",
    description: "retrieval, grounding, RAG evaluation, enterprise search, long-context vs retrieval",
  },
  {
    name: "LLMs for code",
    description: "code generation, program repair, code review, software engineering agents, code benchmarks",
  },
  {
    name: "Computer vision for industrial applications",
    description: "visual inspection, defect detection, manufacturing quality control, robotics perception",
  },
];

type SourceSeed = {
  kind: string;
  role: string;
  enabled: boolean;
  priority: number;
  secretName: string | null;
  params: Record<string, unknown>;
};

const sources: SourceSeed[] = [
  {
    kind: "arxiv",
    role: "discover",
    enabled: true,
    priority: 10,
    secretName: null,
    params: {
      categories: ["cs.AI", "cs.CL", "cs.LG", "cs.CV", "cs.IR", "cs.SE"],
      backstopDays: 4,
      maxResults: 2000,
      minIntervalMs: 3100,
    },
  },
  {
    kind: "hf",
    role: "attention",
    enabled: true,
    priority: 20,
    secretName: "hf",
    params: { dailyDays: 3, dailyLimit: 100, detailConcurrency: 5 },
  },
  {
    kind: "openreview",
    role: "validation",
    enabled: true,
    priority: 30,
    secretName: null,
    params: { maxPerDay: 10, maxPerSunday: 15, minIntervalMs: 3100, titleJaccard: 0.9 },
  },
  {
    kind: "s2",
    role: "enrich",
    enabled: true,
    priority: 40,
    secretName: null,
    params: { batchSize: 500, retryDelaysSeconds: [4, 8, 16], jitter: 0.2 },
  },
  {
    kind: "acl",
    role: "validation",
    enabled: true,
    priority: 50,
    secretName: null,
    params: { repo: "acl-org/acl-anthology", path: "data/xml", branch: "master" },
  },
  {
    kind: "cvf",
    role: "validation",
    enabled: true,
    priority: 60,
    secretName: null,
    params: { menuUrl: "https://openaccess.thecvf.com/menu" },
  },
  {
    kind: "pmlr",
    role: "validation",
    enabled: true,
    priority: 70,
    secretName: null,
    params: { feedUrl: "https://proceedings.mlr.press/feed.xml" },
  },
  {
    kind: "unpaywall",
    role: "fulltext",
    enabled: true,
    priority: 80,
    secretName: null,
    params: { email: "sathshh@gmail.com", htmlMaxChars: 20000 },
  },
  {
    kind: "core",
    role: "fulltext",
    enabled: false,
    priority: 90,
    secretName: "core",
    params: {},
  },
];

async function main() {
  await sql`
    insert into research_signal.app_settings (id, recipients, thresholds, weights)
    values (1, ${recipients}, ${sql.json(thresholds)}, ${sql.json(weights)})
    on conflict (id) do nothing`;

  for (const domain of domains) {
    await sql`
      insert into research_signal.domains (name, description, keywords)
      values (${domain.name}, ${domain.description}, ${[] as string[]})
      on conflict (name) do nothing`;
  }

  for (const source of sources) {
    await sql`
      insert into research_signal.sources (kind, role, enabled, priority, secret_name, params)
      values (
        ${source.kind}, ${source.role}, ${source.enabled}, ${source.priority},
        ${source.secretName}, ${sql.json(source.params as postgres.JSONValue)}
      )
      on conflict (kind) do nothing`;
  }

  const [counts] = await sql<{ domains: number; sources: number }[]>`
    select
      (select count(*)::int from research_signal.domains) as domains,
      (select count(*)::int from research_signal.sources) as sources`;
  console.log(`seeded: ${counts.domains} domains, ${counts.sources} sources`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
