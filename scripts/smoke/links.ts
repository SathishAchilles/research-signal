import { signAction, verifyAction } from "@/lib/brief/actions-link";

export default async function run() {
  const claim = { p: "00000000-0000-4000-8000-000000000001", b: "00000000-0000-4000-8000-000000000002", a: "CLIENT" as const };
  const token = signAction(claim);
  const verified = verifyAction(token);
  console.log(`signed ${token.length} chars, verified: ${JSON.stringify(verified)}`);
  if (JSON.stringify(verified) !== JSON.stringify(claim)) throw new Error("round trip failed");

  let rejected = 0;
  for (const index of [3, Math.floor(token.length / 2), token.length - 1]) {
    const c = token[index];
    const tampered = token.slice(0, index) + (c === "A" ? "B" : "A") + token.slice(index + 1);
    if (verifyAction(tampered) === null) rejected++;
    else throw new Error(`tampered token (index ${index}) verified`);
  }
  console.log(`one-character changes rejected: ${rejected}/3 (null)`);

  const expired = signAction(claim, Date.now() - 31 * 86_400_000);
  if (verifyAction(expired) !== null) throw new Error("expired token verified");
  console.log("31-day-old token rejected: null");
}
