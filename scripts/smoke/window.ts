import { briefWindow, nextSendTime, windowForIsoWeek } from "@/lib/brief/window";

const CASES: [string, string, string][] = [
  ["2026-10-11T12:00:00Z", "2026-W41", "Mon 5 Oct – Fri 9 Oct"],
  ["2026-10-12T09:00:00Z", "2026-W41", "Mon 5 Oct – Fri 9 Oct"],
  ["2026-10-10T00:00:00Z", "2026-W41", "Mon 5 Oct – Fri 9 Oct"],
  ["2026-10-09T23:59:59Z", "2026-W40", "Mon 28 Sep – Fri 2 Oct"],
  ["2027-01-03T12:00:00Z", "2026-W53", "Mon 28 Dec – Fri 1 Jan"],
];

// [now, expected scheduledAt or null for "send now"] for Asia/Kolkata at 07:00 (01:30 UTC Monday).
const SEND_CASES: [string, string | null][] = [
  ["2026-10-11T12:00:00Z", "2026-10-12T01:30:00.000Z"],
  ["2026-10-11T20:00:00Z", "2026-10-12T01:30:00.000Z"],
  ["2026-10-12T01:00:00Z", "2026-10-12T01:30:00.000Z"],
  ["2026-10-12T02:00:00Z", null],
  ["2026-10-13T09:00:00Z", null],
  ["2026-10-17T03:00:00Z", "2026-10-19T01:30:00.000Z"],
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

  for (const [at, expected] of SEND_CASES) {
    const now = new Date(at);
    const got = nextSendTime(briefWindow(now), now, "Asia/Kolkata", "07:00")?.toISOString() ?? null;
    if (got !== expected) throw new Error(`${at}: expected scheduledAt ${expected ?? "omitted"}, got ${got ?? "omitted"}`);
  }
  console.log(`${SEND_CASES.length} send-time cases ok`);
}
