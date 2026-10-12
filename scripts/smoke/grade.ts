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
}
