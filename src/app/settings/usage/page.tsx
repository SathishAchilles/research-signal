import { eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { GET as getHealth } from "@/app/api/health/route";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConeChart } from "@/components/viz/ConeChart";
import { StatTile } from "@/components/viz/StatTile";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { ModelForm } from "./model-form";

const SCHEMA_WARN_BYTES = 300 * 1024 * 1024;
const RUN_HISTORY = 40;
const CONE_STAGES = 6;

type Health = {
  db: string;
  schemaBytes?: number;
  schedulerStale?: boolean;
  llmCreditsExhausted?: boolean;
  modelsMissing?: string[] | null;
  modelsError?: string;
  error?: string;
};

type CostRow = { stage: string; week: number; month: number; calls: number };
type RunRow = {
  source_kind: string | null;
  stage: string;
  started_at: string | Date;
  finished_at: string | Date | null;
  status: string | null;
  items: number | null;
  error: string | null;
};

// Wide tables scroll sideways inside their plate on phones; the first column stays pinned on an opaque plate.
const STICKY_COL = "sticky left-0 z-10 bg-plate-solid";
// Below lg the table's scroll container fades at the right edge to show that more columns scroll in.
const TABLE_FADE = "max-lg:[&_[data-slot=table-container]]:[mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)]";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const when = (v: string | Date) => new Date(v).toISOString().replace("T", " ").slice(0, 16);

function duration(start: string | Date, end: string | Date | null): string {
  if (!end) return "running";
  const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return seconds < 120 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

// The cone chart shows the stages that cost something this week; the table below keeps every stage.
function coneData(costs: CostRow[]) {
  const spent = costs
    .map((r) => ({ label: r.stage, value: Number(r.week) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = spent.slice(0, CONE_STAGES);
  const rest = spent.slice(CONE_STAGES).reduce((sum, d) => sum + d.value, 0);
  if (rest > 0) top.push({ label: "other", value: rest });
  return top.map((d) => ({ ...d, display: usd(d.value) }));
}

async function Usage() {
  await connection();
  const [health, costs, runs, [settings]] = await Promise.all([
    getHealth().then((r) => r.json() as Promise<Health>),
    db.execute<CostRow>(sql`
      select stage,
        coalesce(sum(cost_usd) filter (where created_at >= date_trunc('week', now())), 0)::float8 as week,
        coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now())), 0)::float8 as month,
        (count(*) filter (where created_at >= date_trunc('month', now())))::int as calls
      from research_signal.llm_calls
      -- A week can start in the previous month, so read from whichever boundary is earlier.
      where created_at >= least(date_trunc('week', now()), date_trunc('month', now()))
      group by stage
      order by month desc`),
    db.execute<RunRow>(sql`
      select source_kind, stage, started_at, finished_at, status, items, error
      from research_signal.source_runs
      order by started_at desc
      limit ${RUN_HISTORY}`),
    db
      .select({ chatModel: appSettings.chatModel, embedModel: appSettings.embedModel })
      .from(appSettings)
      .where(eq(appSettings.id, 1)),
  ]);

  const weekTotal = costs.reduce((sum, r) => sum + Number(r.week), 0);
  const monthTotal = costs.reduce((sum, r) => sum + Number(r.month), 0);
  const monthCalls = costs.reduce((sum, r) => sum + Number(r.calls), 0);
  const schemaBytes = health.schemaBytes ?? 0;
  const weekByStage = coneData(costs);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="LLM cost this week" value={usd(weekTotal)} />
        <StatTile
          label="LLM cost this month"
          value={usd(monthTotal)}
          hint={`${monthCalls} ${monthCalls === 1 ? "call" : "calls"} this month`}
        />
        <div className="flex flex-col gap-2">
          <StatTile label="Database storage" value={mb(schemaBytes)} />
          {schemaBytes > SCHEMA_WARN_BYTES && (
            <Badge variant="destructive">Above 300 MB; check retention</Badge>
          )}
        </div>
        <div className="plate flex flex-col items-start gap-2 rounded-tile p-4">
          <h2 className="micro">Scheduler</h2>
          {health.db !== "ok" ? (
            <Badge variant="destructive">health check failed</Badge>
          ) : health.schedulerStale ? (
            <Badge variant="destructive">stale: no job done in 26 h</Badge>
          ) : (
            <Badge>running</Badge>
          )}
          {health.llmCreditsExhausted && <Badge variant="destructive">LLM credits exhausted</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <section className="plate p-4">
          <ConeChart title="LLM cost this week by stage" unit="USD" data={weekByStage} />
        </section>

        <section className={`plate flex flex-col gap-3 p-4 ${TABLE_FADE}`}>
          <h2 className="micro">Cost by stage</h2>
          {costs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No LLM calls this month.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={STICKY_COL}>Stage</TableHead>
                  <TableHead className="text-right">This week</TableHead>
                  <TableHead className="text-right">This month</TableHead>
                  <TableHead className="text-right">Calls this month</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((r) => (
                  <TableRow key={r.stage}>
                    <TableCell className={`${STICKY_COL} font-mono`}>{r.stage}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(Number(r.week))}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(Number(r.month))}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(r.calls)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>

      <section className={`plate flex flex-col gap-3 p-4 ${TABLE_FADE}`}>
        <h2 className="micro">Source run history</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={STICKY_COL}>Started (UTC)</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Time</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r, i) => (
                <TableRow key={`${String(r.started_at)}-${i}`}>
                  <TableCell className={`${STICKY_COL} tabular-nums`}>{when(r.started_at)}</TableCell>
                  <TableCell className="font-mono">{r.source_kind ?? "—"}</TableCell>
                  <TableCell className="font-mono">{r.stage}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "FAILED" ? "destructive" : r.status === "OK" ? "default" : "secondary"}>
                      {r.status ?? "running"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.items ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{duration(r.started_at, r.finished_at)}</TableCell>
                  <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={r.error ?? undefined}>
                    {r.error}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="plate flex flex-col gap-3 p-4">
        <h2 className="micro">Models</h2>
        {health.modelsMissing && health.modelsMissing.length > 0 && (
          <p className="text-sm text-destructive">
            Not available on OpenRouter: {health.modelsMissing.join(", ")}
          </p>
        )}
        {health.modelsError && (
          <p className="text-sm text-muted-foreground">Model availability check failed: {health.modelsError}</p>
        )}
        {settings ? (
          <ModelForm initial={settings} />
        ) : (
          <p className="text-sm text-destructive">Settings row is missing; run npm run seed.</p>
        )}
      </section>
    </div>
  );
}

export default function UsagePage() {
  return (
    <section className="flex flex-col gap-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading usage…</p>}>
        <Usage />
      </Suspense>
    </section>
  );
}
