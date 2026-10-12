import { briefWindow, windowForIsoWeek } from "@/lib/brief/window";

const CASES: [string, string, string][] = [
  ["2026-10-11T12:00:00Z", "2026-W41", "Mon 5 Oct – Fri 9 Oct"],
  ["2026-10-12T09:00:00Z", "2026-W41", "Mon 5 Oct – Fri 9 Oct"],
  ["2026-10-10T00:00:00Z", "2026-W41", "Mon 5 Oct – Fri 9 Oct"],
  ["2026-10-09T23:59:59Z", "2026-W40", "Mon 28 Sep – Fri 2 Oct"],
  ["2027-01-03T12:00:00Z", "2026-W53", "Mon 28 Dec – Fri 1 Jan"],
];

export default async function run(args: string[]) {
  const now = new Date(args[0] ?? CASES[0][0]);
  const w = briefWindow(now);
  console.log(`${now.toISOString()} -> ${w.isoWeek} "${w.label}" [${w.start.toISOString()}, ${w.end.toISOString()})`);

  for (const [at, isoWeek, label] of CASES) {
    const got = briefWindow(new Date(at));
    if (got.isoWeek !== isoWeek || got.label !== label) {
      throw new Error(`${at}: expected ${isoWeek} "${label}", got ${got.isoWeek} "${got.label}"`);
    }
    const back = windowForIsoWeek(isoWeek);
    if (back?.start.getTime() !== got.start.getTime()) throw new Error(`windowForIsoWeek(${isoWeek}) mismatch`);
  }
  console.log(`${CASES.length} window cases ok`);
}
