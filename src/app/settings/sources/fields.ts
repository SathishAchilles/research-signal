import { z } from "zod";
import { registry } from "@/lib/sources/registry";
import type { SourceKind } from "@/lib/sources/types";
import { categoryError, splitList } from "../_lib/validation";

export type ParamKind = "string" | "number" | "integer" | "boolean" | "string[]" | "number[]";
export type ParamField = { key: string; label: string; kind: ParamKind };
export type ParamValues = Record<string, string | boolean>;

type JsonProperty = { type?: string; items?: { type?: string } };

function label(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindOf(property: JsonProperty): ParamKind {
  if (property.type === "array") {
    const item = property.items?.type;
    return item === "number" || item === "integer" ? "number[]" : "string[]";
  }
  if (property.type === "integer" || property.type === "number" || property.type === "boolean") return property.type;
  return "string";
}

// Form fields derived from the adapter's zod paramsSchema.
export function paramFields(kind: SourceKind): ParamField[] {
  const json = z.toJSONSchema(registry[kind].paramsSchema, { io: "input" }) as {
    properties?: Record<string, JsonProperty>;
  };
  return Object.entries(json.properties ?? {}).map(([key, property]) => ({ key, label: label(key), kind: kindOf(property) }));
}

export function toFormValues(fields: ParamField[], params: Record<string, unknown>): ParamValues {
  return Object.fromEntries(
    fields.map(({ key, kind }) => {
      const value = params[key];
      if (kind === "boolean") return [key, value === true];
      if (Array.isArray(value)) return [key, value.join(", ")];
      return [key, value === undefined || value === null ? "" : String(value)];
    }),
  );
}

function fromFormValue(kind: ParamKind, raw: string | boolean | undefined): unknown {
  if (kind === "boolean") return raw === true;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return undefined;
  if (kind === "number" || kind === "integer") return Number(text);
  if (kind === "number[]") return splitList(text).map(Number);
  if (kind === "string[]") return splitList(text);
  return text;
}

// Parses submitted form values with the adapter schema; empty fields fall back to the schema defaults.
export function parseParams(
  kind: SourceKind,
  values: ParamValues,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const fields = paramFields(kind);
  const raw = Object.fromEntries(fields.map((f) => [f.key, fromFormValue(f.kind, values[f.key])]));
  const parsed = registry[kind].paramsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.length ? `${label(String(issue.path[0]))}: ` : "";
    return { ok: false, error: `${field}${issue?.message ?? "Invalid parameters"}` };
  }
  const params = parsed.data as Record<string, unknown>;
  if (kind === "arxiv" && Array.isArray(params.categories)) {
    const error = categoryError(params.categories as string[]);
    if (error) return { ok: false, error };
  }
  return { ok: true, params };
}
