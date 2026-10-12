import { z } from "zod";
import { assertModelAllowed } from "@/lib/llm/openrouter";

export const ARXIV_CATEGORY = /^[a-z-]+\.[A-Z]{2}$|^stat\.ML$/;
export const DESCRIPTION_MAX = 300;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

// Splits a comma- or newline-separated field into trimmed, de-duplicated, non-empty entries.
export function splitList(raw: string): string[] {
  return [...new Set(raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

export function invalidCategories(categories: string[]): string[] {
  return categories.filter((c) => !ARXIV_CATEGORY.test(c));
}

export function categoryError(categories: string[]): string | null {
  const bad = invalidCategories(categories);
  return bad.length === 0
    ? null
    : `Invalid arXiv ${bad.length === 1 ? "category" : "categories"}: ${bad.join(", ")}. Use the form cs.CL or stat.ML.`;
}

const domainSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name must be at most 80 characters"),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX, `Description must be at most ${DESCRIPTION_MAX} characters`),
  keywords: z.array(z.string()),
  excludes: z.array(z.string()),
  arxivCategories: z.array(z.string()),
  venues: z.array(z.string()),
  active: z.boolean(),
});

export type DomainInput = z.infer<typeof domainSchema>;

export function validateDomain(input: {
  name: string;
  description: string;
  keywords: string;
  excludes: string;
  arxivCategories: string;
  venues: string;
  active: boolean;
}): Validated<DomainInput> {
  const parsed = domainSchema.safeParse({
    name: input.name,
    description: input.description,
    keywords: splitList(input.keywords),
    excludes: splitList(input.excludes),
    arxivCategories: splitList(input.arxivCategories),
    venues: splitList(input.venues),
    active: input.active,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid domain" };
  const error = categoryError(parsed.data.arxivCategories);
  return error ? { ok: false, error } : { ok: true, value: parsed.data };
}

const SEND_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type DeliveryInput = { recipients: string[]; sendLocalTime: string; timezone: string };

export function validateDelivery(input: { recipients: string; sendLocalTime: string; timezone: string }): Validated<DeliveryInput> {
  const recipients = splitList(input.recipients);
  if (recipients.length === 0) return { ok: false, error: "Add at least one recipient." };
  const badEmail = recipients.find((r) => !z.email().safeParse(r).success);
  if (badEmail) return { ok: false, error: `Not a valid email address: ${badEmail}` };
  const sendLocalTime = input.sendLocalTime.trim();
  if (!SEND_TIME.test(sendLocalTime)) return { ok: false, error: "Send time must be HH:MM in 24-hour time." };
  const timezone = input.timezone.trim();
  if (!isTimeZone(timezone)) return { ok: false, error: `Unknown timezone: ${timezone}` };
  return { ok: true, value: { recipients, sendLocalTime, timezone } };
}

// Format check only; availability on OpenRouter is checked separately.
export function modelFormatError(id: string): string | null {
  if (id.trim() === "") return "Model id is required.";
  try {
    assertModelAllowed(id.trim());
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
