import { env } from "@/lib/env";
import { signAction } from "./actions-link";
import { COLORS, SIGNAL_BORDER, VERDICT_LABEL, attentionText, meterText } from "./cues";
import { formatPercent } from "./tokens";
import type { ActionKind, BriefCard, BriefDoc, DomainSelection } from "./types";

export const EMAIL_BYTE_LIMIT = 90_000;

const ACTION_LABEL: Record<ActionKind, string> = { READ: "Read", CLIENT: "Bring to client", SKIP: "Skip" };

const FONT = "font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Prose = {
  card: Map<string, BriefDoc["prose"]["domains"][number]["cards"][number]>;
  top3: Map<string, string>;
  rising: Map<string, string>;
};

function proseIndex(brief: BriefDoc): Prose {
  return {
    card: new Map(brief.prose.domains.flatMap((d) => d.cards.map((c) => [c.cardId, c] as const))),
    top3: new Map(brief.prose.top3.map((t) => [t.cardId, t.pointer])),
    rising: new Map(brief.prose.rising.map((r) => [r.cardId, r.line])),
  };
}

const link = (href: string, text: string) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

// What moved to the web page, in the order it moves when the email is too large.
export const WEB_ONLY_STEPS = ["compact", "rising", "standard"] as const;
type WebOnly = Set<(typeof WEB_ONLY_STEPS)[number]>;

const webLink = (brief: BriefDoc, anchor: string, text: string) =>
  `<tr><td colspan="2" style="padding:4px 12px;${FONT}font-size:13px;">${link(`${env.APP_URL}/brief/${brief.selection.isoWeek}#${anchor}`, text)}</td></tr>`;

function chip(card: BriefCard): string {
  return `<span style="display:inline-block;border:2px ${SIGNAL_BORDER[card.signalType]} ${COLORS.ink};padding:0 4px;font-size:11px;font-weight:bold;">${card.signalType}</span>`;
}

function links(card: BriefCard): string {
  const out = [
    card.links.abs && link(card.links.abs, "Abstract"),
    card.links.pdf && link(card.links.pdf, "PDF"),
    card.links.code && link(card.links.code, "Code"),
    card.links.hf && link(card.links.hf, "HF"),
  ].filter(Boolean);
  return out.join(" · ");
}

function actionLinks(card: BriefCard, briefId: string): string {
  return (["READ", "CLIENT", "SKIP"] as const)
    .map((a) => link(`${env.APP_URL}/a/${signAction({ p: card.paperId, b: briefId, a })}`, ACTION_LABEL[a]))
    .join(" &nbsp;|&nbsp; ");
}

function cueLine(card: BriefCard): string {
  const rising =
    card.evidence.rising_pct != null && card.tier === "RISING"
      ? ` &nbsp;<span style="color:${COLORS.rising};font-weight:bold;">UP ${formatPercent(card.evidence.rising_pct)}</span>`
      : "";
  return `<b>${VERDICT_LABEL[card.verdict]}</b> &nbsp;<code style="font-size:12px;">${meterText(card.rung)}</code> &nbsp;${chip(card)}${rising}`;
}

function cardRow(card: BriefCard, brief: BriefDoc, body: string): string {
  return `<tr><td width="4" bgcolor="${COLORS.verdict[card.verdict]}" style="width:4px;background:${COLORS.verdict[card.verdict]};font-size:0;">&nbsp;</td>
<td style="padding:8px 12px;${FONT}color:${COLORS.ink};font-size:14px;line-height:1.45;">
<div style="font-size:12px;">${cueLine(card)}</div>
${body}
<div style="font-size:12px;color:${COLORS.muted};margin-top:4px;">${escapeHtml(attentionText(card))}</div>
<div style="font-size:12px;margin-top:4px;">${links(card)}</div>
<div style="font-size:12px;margin-top:6px;">${actionLinks(card, brief.briefId)}</div>
</td></tr>
<tr><td colspan="2" height="10" style="font-size:0;height:10px;">&nbsp;</td></tr>`;
}

function heroOrStandard(card: BriefCard, brief: BriefDoc, prose: Prose): string {
  const p = prose.card.get(card.cardId);
  const headline = p?.headline || card.title;
  const body = [
    `<div style="font-size:${card.tier === "HERO" ? 17 : 15}px;font-weight:bold;margin-top:4px;">${escapeHtml(headline)}</div>`,
    `<div style="font-size:13px;color:${COLORS.muted};">${escapeHtml(card.title)}</div>`,
    card.tier === "HERO" && p?.lede ? `<div style="margin-top:4px;">${escapeHtml(p.lede)}</div>` : "",
    `<div style="margin-top:4px;"><b>Client angle:</b> ${escapeHtml(p?.clientAngle || card.clientAngle)}</div>`,
    p?.verdictReason ? `<div style="font-size:12px;color:${COLORS.muted};">Why: ${escapeHtml(p.verdictReason)}</div>` : "",
  ].join("\n");
  return cardRow(card, brief, body);
}

function compactRow(card: BriefCard, brief: BriefDoc): string {
  return cardRow(card, brief, `<div style="margin-top:2px;">${escapeHtml(card.title)}</div>`);
}

const top3Note = (card: BriefCard) =>
  `<tr><td colspan="2" style="padding:4px 12px;${FONT}font-size:13px;color:${COLORS.muted};">In Top 3 above: ${escapeHtml(card.title)}</td></tr>`;

function domainSection(domain: DomainSelection, brief: BriefDoc, prose: Prose, webOnly: WebOnly): string {
  const cards = brief.selection.cards;
  const intro = brief.prose.domains.find((d) => d.domainId === domain.domainId);
  const introText = intro ? [intro.situation, intro.complication, intro.implication].filter(Boolean).join(" ") : "";
  const rows: string[] = [];
  const hidden: string[] = [];
  if (domain.hero) rows.push(cards[domain.hero].inTop3 ? top3Note(cards[domain.hero]) : heroOrStandard(cards[domain.hero], brief, prose));
  for (const id of domain.standard) {
    if (cards[id].inTop3) rows.push(top3Note(cards[id]));
    else if (webOnly.has("standard")) hidden.push(id);
    else rows.push(heroOrStandard(cards[id], brief, prose));
  }
  for (const id of domain.compact) {
    if (cards[id].inTop3) rows.push(top3Note(cards[id]));
    else if (webOnly.has("compact")) hidden.push(id);
    else rows.push(compactRow(cards[id], brief));
  }
  if (hidden.length > 0) rows.push(webLink(brief, domain.slug, `${hidden.length} more on the web`));
  const quiet = domain.quiet
    ? `<div style="font-size:13px;color:${COLORS.muted};">Quiet week. Nearest miss: ${
        domain.nearestMiss ? `${escapeHtml(domain.nearestMiss.title)} (score ${domain.nearestMiss.final.toFixed(2)})` : "none"
      }</div>`
    : "";
  return `<tr><td style="padding:18px 0 6px;${FONT}color:${COLORS.ink};">
<a name="${domain.slug}"></a><div style="font-size:18px;font-weight:bold;border-bottom:1px solid ${COLORS.rule};padding-bottom:4px;">${escapeHtml(domain.name)}</div>
${introText ? `<div style="font-size:14px;margin-top:6px;">${escapeHtml(introText)}</div>` : ""}
${quiet}
</td></tr>
${rows.length ? `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("\n")}</table></td></tr>` : ""}`;
}

function top3Strip(brief: BriefDoc, prose: Prose): string {
  if (brief.selection.top3.length === 0) return "";
  const rows = brief.selection.top3.map((id) => {
    const card = brief.selection.cards[id];
    const pointer = prose.top3.get(id);
    const body = `<div style="font-size:15px;font-weight:bold;margin-top:4px;">${escapeHtml(card.title)}</div>${
      pointer ? `<div style="margin-top:2px;">${escapeHtml(pointer)}</div>` : ""
    }<div style="margin-top:2px;"><b>Client angle:</b> ${escapeHtml(prose.card.get(id)?.clientAngle || card.clientAngle)}</div>`;
    return cardRow(card, brief, body);
  });
  return `<tr><td style="padding:12px 0 6px;${FONT}font-size:18px;font-weight:bold;color:${COLORS.ink};">Top 3</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("\n")}</table></td></tr>`;
}

function risingLane(brief: BriefDoc, prose: Prose, webOnly: WebOnly): string {
  const ids = brief.selection.rising;
  if (ids.length === 0) return "";
  const rows = webOnly.has("rising")
    ? [webLink(brief, "rising", `${ids.length} rising papers on the web`)]
    : ids.map((id) => {
        const card = brief.selection.cards[id];
        const line = prose.rising.get(id);
        return cardRow(card, brief, `<div style="margin-top:2px;font-weight:bold;">${escapeHtml(card.title)}</div>${line ? `<div>${escapeHtml(line)}</div>` : ""}`);
      });
  return `<tr><td style="padding:18px 0 6px;${FONT}font-size:18px;font-weight:bold;color:${COLORS.rising};">Rising</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("\n")}</table></td></tr>`;
}

function footer(brief: BriefDoc): string {
  const health = brief.selection.sourceHealth.length
    ? brief.selection.sourceHealth.map((h) => `<li>${escapeHtml(h.kind)}: ${escapeHtml(h.note)}</li>`).join("")
    : "<li>All sources reported normally.</li>";
  return `<tr><td style="padding:24px 0 8px;${FONT}font-size:12px;color:${COLORS.muted};border-top:1px solid ${COLORS.rule};">
<div>Covers announcements ${escapeHtml(brief.selection.label)}.</div>
<div style="margin-top:6px;">Source health:</div><ul style="margin:4px 0 0 16px;padding:0;">${health}</ul>
<div style="margin-top:6px;">Legend: bar and label = suggested verdict; [####] = evidence rung (LAB, CODE, MODEL, PEER); boxed tag = signal type (BENCH solid, EVAL dashed, REFRAME dotted, METHOD double).</div>
<div style="margin-top:6px;">${link(`${env.APP_URL}/brief/${brief.selection.isoWeek}`, "Open this brief on the web")}</div>
</td></tr>`;
}

function render(brief: BriefDoc, webOnly: WebOnly): string {
  const prose = proseIndex(brief);
  const sections = brief.selection.domains.map((d) => domainSection(d, brief, prose, webOnly)).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>research-signal ${escapeHtml(brief.selection.isoWeek)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="${FONT}color:${COLORS.ink};"><div style="font-size:12px;color:${COLORS.muted};">research-signal · ${escapeHtml(brief.selection.isoWeek)}</div>
<div style="font-size:20px;font-weight:bold;margin-top:4px;">${escapeHtml(brief.prose.weekLine)}</div></td></tr>
${top3Strip(brief, prose)}
${sections}
${risingLane(brief, prose, webOnly)}
${footer(brief)}
</table></td></tr></table></body></html>
`;
}

// Inline-styled nested tables with no images or scripts. Over 90,000 bytes, compact rows move to the
// web first; for unusually large weeks the rising lane and then standard cards follow.
export function renderEmail(brief: BriefDoc): { html: string; bytes: number; compactOnWeb: boolean; webOnly: string[] } {
  const webOnly: WebOnly = new Set();
  let html = render(brief, webOnly);
  let bytes = Buffer.byteLength(html, "utf8");
  for (const step of WEB_ONLY_STEPS) {
    if (bytes <= EMAIL_BYTE_LIMIT) break;
    webOnly.add(step);
    html = render(brief, webOnly);
    bytes = Buffer.byteLength(html, "utf8");
  }
  return { html, bytes, compactOnWeb: webOnly.has("compact"), webOnly: [...webOnly] };
}
