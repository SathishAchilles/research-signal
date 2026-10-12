import { fillTokens } from "@/lib/brief/tokens";

const evidence = { p3: { hf_upvotes: 412, github_stars: 1234, rising_pct: 38.2 } };
const CASES: [string, string][] = [
  ["HF {{ev:p3.hf_upvotes}} · {{ev:p3.github_stars}} stars", "HF 412 · 1.2k stars"],
  ["upvotes {{ev:p3.rising_pct}} this week", "upvotes +38% this week"],
  ["{{ev:p3.s2_citations}} citations, {{ev:p9.hf_upvotes}}", "n/a citations, n/a"],
];

export default async function run() {
  for (const [text, expected] of CASES) {
    const got = fillTokens(text, evidence);
    console.log(got);
    if (got !== expected) throw new Error(`expected "${expected}"`);
  }
}
