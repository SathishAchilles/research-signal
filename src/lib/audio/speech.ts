import type { BriefDoc } from "@/lib/brief/types";
import type { Rung, SignalType, Verdict } from "@/lib/pipeline/rank";

// Text the browser reads aloud: one segment per readable block, keyed by the DOM id it highlights.
// Pure and type-only on its imports so it runs on the server and in the client bundle alike.
export type SpeechSegment = { id: string; label: string; text: string };

const VERDICT_SPOKEN: Record<Verdict, string> = { CLIENT: "Bring to client", READ: "Worth a read", SKIP: "Skim only" };
const RUNG_SPOKEN: Record<Rung, string> = {
  LAB: "lab result only",
  CODE: "code released",
  MODEL: "model released",
  PEER: "peer reviewed",
};
const SIGNAL_SPOKEN: Record<SignalType, string> = {
  BENCH: "benchmark",
  EVAL: "evaluation",
  REFRAME: "reframe",
  METHOD: "method",
};

// Evidence tokens like {{ev:p3.hf_upvotes}}; prose is stored filled, so any survivor is dropped.
const EVIDENCE_TOKEN = /\{\{[^}]*\}\}/g;

// Strips markup and rewrites what a speech engine mispronounces. Order matters: links and tags
// go before punctuation, units before abbreviations.
export function toSpeakable(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(EVIDENCE_TOKEN, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`+/g, "")
    .replace(/(\*\*|__|\*|~~)/g, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/&amp;/g, " and ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/\+(\d+(?:\.\d+)?)\s*%/g, "up $1 percent")
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent")
    .replace(/\b(\d+(?:\.\d+)?)k\b/g, "$1 thousand")
    .replace(/\b(\d+(?:\.\d+)?)M\b/g, "$1 million")
    .replace(/\bHF\b/g, "Hugging Face")
    .replace(/\barXiv\b/gi, "archive")
    .replace(/\bSOTA\b/g, "state of the art")
    .replace(/\bvs\.?(?=\s)/g, "versus")
    .replace(/\be\.g\.,?/g, "for example")
    .replace(/\bi\.e\.,?/g, "that is")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Joins clauses into sentences so the engine pauses between them.
function sentences(...parts: (string | null | undefined)[]): string {
  return parts
    .map(toSpeakable)
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(" ");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildBriefSpeech(doc: BriefDoc): SpeechSegment[] {
  const { selection, prose } = doc;
  const segments: SpeechSegment[] = [];
  const cardProse = new Map(prose.domains.flatMap((d) => d.cards.map((c) => [c.cardId, c] as const)));

  segments.push({
    id: "brief-intro",
    label: "This week",
    text: sentences(`Research signal brief, ${selection.label.replace(/\s+[–—-]\s+/g, " to ")}`, prose.weekLine),
  });

  const pointers = new Map(prose.top3.map((t) => [t.cardId, t.pointer]));
  const top3 = selection.top3
    .map((id, i) => {
      const card = selection.cards[id];
      if (!card) return "";
      const pointer = pointers.get(id) || cardProse.get(id)?.headline || card.title;
      return sentences(`Number ${i + 1}`, pointer);
    })
    .filter(Boolean);
  if (top3.length) {
    segments.push({ id: "top3-heading", label: "Top 3", text: sentences("The top three this week") + " " + top3.join(" ") });
  }

  const quiet: string[] = [];
  for (const domain of selection.domains) {
    const intro = prose.domains.find((d) => d.domainId === domain.domainId);
    const ids = [domain.hero, ...domain.standard, ...domain.compact].filter((id): id is string => Boolean(id && selection.cards[id]));
    if (domain.quiet && ids.length === 0) {
      quiet.push(domain.name);
      continue;
    }
    const domainText = sentences(
      domain.name,
      intro?.situation,
      intro?.complication,
      intro?.implication,
      ids.length ? plural(ids.length, "paper", "papers") + " this week" : null,
    );
    if (domainText) segments.push({ id: domain.slug, label: domain.name, text: domainText });

    for (const id of ids) {
      const card = selection.cards[id];
      const p = cardProse.get(id);
      const text = sentences(
        p?.headline || card.title,
        p?.lede,
        p?.clientAngle || card.clientAngle ? `Client angle: ${toSpeakable(p?.clientAngle || card.clientAngle)}` : null,
        `Verdict: ${VERDICT_SPOKEN[card.verdict]}`,
        p?.verdictReason,
      );
      segments.push({ id: `card-${id}`, label: toSpeakable(p?.headline || card.title), text });
    }
  }

  if (quiet.length) {
    segments.push({
      id: "brief-quiet",
      label: "Quiet domains",
      text: sentences(`Quiet this week: ${quiet.join(", ")}`, "Nothing cleared the bar there"),
    });
  }

  return segments.filter((s) => s.text);
}

export type PaperSpeechInput = {
  title: string;
  abstract: string | null;
  signalType: SignalType | null;
  rung: Rung | null;
  verdict: Verdict | null;
  clientAngle: string | null;
  domainName?: string | null;
};

export function buildPaperSpeech(paper: PaperSpeechInput): SpeechSegment[] {
  const segments: SpeechSegment[] = [
    {
      id: "paper-title",
      label: "Title",
      text: sentences(
        paper.title,
        paper.signalType ? `Signal type: ${SIGNAL_SPOKEN[paper.signalType]}` : null,
        paper.rung ? `Evidence: ${RUNG_SPOKEN[paper.rung]}` : null,
      ),
    },
  ];
  if (paper.verdict || paper.clientAngle) {
    segments.push({
      id: "paper-verdict",
      label: "Verdict",
      text: sentences(
        paper.verdict ? `Verdict${paper.domainName ? ` for ${paper.domainName}` : ""}: ${VERDICT_SPOKEN[paper.verdict]}` : null,
        paper.clientAngle ? `Client angle: ${toSpeakable(paper.clientAngle)}` : null,
      ),
    });
  }
  if (paper.abstract) segments.push({ id: "paper-abstract", label: "Abstract", text: sentences("Abstract", paper.abstract) });
  return segments.filter((s) => s.text);
}
