import { parseParams } from "@/app/settings/sources/fields";
import { modelFormatError, validateDelivery, validateDomain } from "@/app/settings/_lib/validation";

function check(label: string, actual: string | null, expected: string | null) {
  const pass = expected === null ? actual === null : actual?.includes(expected) === true;
  console.log(`${pass ? "ok  " : "FAIL"} ${label}: ${actual ?? "accepted"}`);
  if (!pass) process.exitCode = 1;
}

const errorOf = (result: { ok: true } | { ok: false; error: string }) => (result.ok ? null : result.error);

export default function run() {
  check("model openai/gpt-5", modelFormatError("openai/gpt-5"), "Model must start with google/");
  check("model google/gemini-3.7-flash", modelFormatError("google/gemini-3.7-flash"), null);

  const domain = {
    name: "Speech AI for contact centres",
    description: "speech recognition, call summarisation and agent assist for contact centres",
    keywords: "ASR, call summarisation",
    excludes: "",
    arxivCategories: "cs.CL, eess.AS, stat.ML",
    venues: "INTERSPEECH",
    active: true,
  };
  check("domain valid", errorOf(validateDomain(domain)), null);
  check("domain bad category", errorOf(validateDomain({ ...domain, arxivCategories: "cs.cl" })), "Invalid arXiv category");
  check("domain long description", errorOf(validateDomain({ ...domain, description: "x".repeat(301) })), "at most 300");

  check(
    "arxiv params bad category",
    errorOf(parseParams("arxiv", { categories: "cs.AI, computer-vision", backstopDays: "4", maxResults: "", minIntervalMs: "" })),
    "Invalid arXiv category",
  );
  check("arxiv params valid", errorOf(parseParams("arxiv", { categories: "cs.AI, cs.CL", backstopDays: "4" })), null);
  check("s2 number list", errorOf(parseParams("s2", { retryDelaysSeconds: "4, 8, 16", jitter: "0.2" })), null);
  check("hf over max", errorOf(parseParams("hf", { dailyLimit: "500" })), "Daily limit");

  const delivery = { recipients: "sathish_babu@pg27.mesaschool.co", sendLocalTime: "07:00", timezone: "Asia/Kolkata" };
  check("delivery valid", errorOf(validateDelivery(delivery)), null);
  check("delivery bad email", errorOf(validateDelivery({ ...delivery, recipients: "nobody" })), "Not a valid email");
  check("delivery bad time", errorOf(validateDelivery({ ...delivery, sendLocalTime: "7am" })), "HH:MM");
  check("delivery bad tz", errorOf(validateDelivery({ ...delivery, timezone: "Mars/Olympus" })), "Unknown timezone");
}
