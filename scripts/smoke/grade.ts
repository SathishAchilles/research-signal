import { validateAnswer, withVerdictConfidence } from "@/lib/ask/answer";
import { confidence } from "@/lib/ask/grade";

export default async function run() {
  const cases = [
    { name: "2 papers", papers: [{ rung: "CODE" as const }, { rung: "PEER" as const }], expected: "Low" },
    { name: "3 LAB papers", papers: Array.from({ length: 3 }, () => ({ rung: "LAB" as const })), expected: "Medium" },
    {
      name: "5 CODE+ papers incl. 1 PEER",
      papers: [
        { rung: "CODE" as const },
        { rung: "CODE" as const },
        { rung: "MODEL" as const },
        { rung: "MODEL" as const },
        { rung: "PEER" as const },
      ],
      expected: "High",
    },
  ];
  for (const c of cases) {
    const got = confidence(c.papers);
    console.log(`${c.name}: ${got}`);
    if (got !== c.expected) throw new Error(`${c.name}: expected ${c.expected}, got ${got}`);
  }

  // The BET verdict line carries the code-computed confidence.
  const verdict = withVerdictConfidence("**Verdict: Pilot** (confidence: High)\n\nBody [p1]", "Medium");
  console.log(`verdict line: ${verdict.split("\n")[0]}`);
  if (verdict.split("\n")[0] !== "**Verdict: Pilot** · Confidence: Medium") throw new Error("verdict line not normalised");

  // Numbers must come from a cited paper, an evidence value or the question context.
  const options = {
    knownRefs: new Set(["p1", "p2"]),
    evidence: { p1: { upvotes: 1234 }, p2: {} },
    paperData: { p1: '{"abstract":"accuracy rises to 87.5% on 3 benchmarks"}', p2: '{"abstract":"a 42% gain with fifteen models"}' },
    context: "What's new since 2026-10-01?",
    wordCap: 500,
  };
  const numberCases = [
    { text: "1. Accuracy reaches 87.5% on 3 benchmarks [p1].", ok: true },
    { text: "It has 1.2k upvotes and {{ev:p1.upvotes}} in total [p1].", ok: true },
    { text: "Since 2026-10-01, accuracy reaches 87.5% [p1].", ok: true },
    { text: "Accuracy gains 42% [p1].", ok: false },
    { text: "Accuracy gains 42% [p2].", ok: true },
    { text: "A panel of 15 models [p1].", ok: false },
    { text: "A panel of 15 models [p2].", ok: true },
  ];
  for (const c of numberCases) {
    const errors = validateAnswer(c.text, options).filter((e) => e.startsWith("Numbers"));
    console.log(`numbers ${c.ok ? "accepted" : "rejected"}: ${c.text}${errors.length ? ` -> ${errors[0]}` : ""}`);
    if ((errors.length === 0) !== c.ok) throw new Error(`number check wrong for: ${c.text}`);
  }
}
