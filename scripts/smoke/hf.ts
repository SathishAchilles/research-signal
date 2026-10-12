import { db } from "@/db/client";
import { fetchDaily, fetchDetail, writeHfSignals } from "@/lib/sources/hf";
import { getSourceSecret } from "@/lib/sources/registry";

function recentWeekdays(count: number): string[] {
  const out: string[] = [];
  for (let d = new Date(); out.length < count; d = new Date(d.getTime() - 86_400_000)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default async function run() {
  try {
    const token = await getSourceSecret("hf");
    console.log(`token: ${token ? "set" : "not set"}`);
    const dates = recentWeekdays(3);
    const daily = await fetchDaily(dates, token);
    console.log(`daily (${dates.join(", ")}): ${daily.length}`);

    const details = await fetchDetail(["2501.12948"], token);
    const [detail] = details;
    console.log(`detail requests failed: ${details.failed}`);
    console.log(
      `detail 2501.12948: upvotes=${detail?.upvotes} githubRepo=${detail?.githubRepo} githubStars=${detail?.githubStars} models=${detail?.linkedModels} spaces=${detail?.linkedSpaces}`,
    );
    if (!detail || detail.githubStars === null) throw new Error("detail has no githubStars");

    const written = await writeHfSignals(daily);
    console.log(`signals written for stored papers: ${written}`);
  } finally {
    await db.$client.end();
  }
}
