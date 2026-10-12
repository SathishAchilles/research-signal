"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ConnectionResult } from "@/lib/sources/types";
import { saveSource, setSourceKey, testSource } from "./actions";
import type { ParamField, ParamValues } from "./fields";

export type SourceView = {
  kind: string;
  role: string;
  enabled: boolean;
  priority: number;
  fields: ParamField[];
  values: ParamValues;
  takesKey: boolean;
  keySet: boolean;
  health: "OK" | "PARTIAL" | "FAILED" | "STALE";
  lastRunAt: string | null;
  lastError: string | null;
  lastItemCount: number | null;
};

const HEALTH_VARIANT = {
  OK: "default",
  PARTIAL: "secondary",
  FAILED: "destructive",
  STALE: "outline",
} as const;

const LIST_HINT: Partial<Record<ParamField["kind"], string>> = {
  "string[]": "Comma-separated",
  "number[]": "Comma-separated numbers",
};

export function SourceCard({ source }: { source: SourceView }) {
  const [enabled, setEnabled] = useState(source.enabled);
  const [priority, setPriority] = useState(String(source.priority));
  const [values, setValues] = useState<ParamValues>(source.values);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<ConnectionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveSource(source.kind, { enabled, priority, params: values });
      setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    });

  const saveKey = () =>
    startTransition(async () => {
      const result = await setSourceKey(source.kind, key);
      setKey("");
      setMessage(result.ok ? { ok: true, text: "Key saved." } : { ok: false, text: result.error });
    });

  const runTest = () =>
    startTransition(async () => {
      setTest(null);
      setTest(await testSource(source.kind));
    });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{source.kind}</span>
          <Badge variant="outline">{source.role}</Badge>
          <Badge variant={HEALTH_VARIANT[source.health]} title={source.lastError ?? undefined}>
            {source.health}
          </Badge>
          <Label className="ml-auto text-xs font-normal text-muted-foreground">
            Enabled
            <Switch size="sm" checked={enabled} onCheckedChange={setEnabled} />
          </Label>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {source.lastRunAt
            ? `Last run ${new Date(source.lastRunAt).toLocaleString()}${source.lastItemCount === null ? "" : `, ${source.lastItemCount} items`}`
            : "Never run"}
          {source.lastError && source.health !== "OK" ? ` · ${source.lastError}` : ""}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
            <Label htmlFor={`${source.kind}-priority`}>Priority</Label>
            <Input
              id={`${source.kind}-priority`}
              type="number"
              min={0}
              step={1}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
            {source.fields.map((field) => {
              const id = `${source.kind}-${field.key}`;
              const value = values[field.key];
              return field.kind === "boolean" ? (
                <div key={field.key} className="contents">
                  <Label htmlFor={id}>{field.label}</Label>
                  <Switch
                    id={id}
                    checked={value === true}
                    onCheckedChange={(checked) => setValues((v) => ({ ...v, [field.key]: checked }))}
                  />
                </div>
              ) : (
                <div key={field.key} className="contents">
                  <Label htmlFor={id}>{field.label}</Label>
                  <Input
                    id={id}
                    type={field.kind === "number" || field.kind === "integer" ? "number" : "text"}
                    step={field.kind === "integer" ? 1 : "any"}
                    value={typeof value === "string" ? value : ""}
                    placeholder={LIST_HINT[field.kind]}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={runTest}>
              Test connection
            </Button>
          </div>
        </form>

        {source.takesKey && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveKey();
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              aria-label={`${source.kind} API key`}
              placeholder={source.keySet ? "Key set; enter a new one to replace it" : "API key"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending || key.trim() === ""}>
              Set key
            </Button>
            {source.keySet && <Badge variant="secondary">key set</Badge>}
          </form>
        )}

        <p role="status" className="min-h-4 text-xs">
          {message && <span className={message.ok ? "text-muted-foreground" : "text-destructive"}>{message.text}</span>}
        </p>
        {test && (
          <p className={test.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {test.ok ? `OK in ${test.latencyMs} ms${test.sample ? ` · ${test.sample}` : ""}` : `Failed after ${test.latencyMs} ms: ${test.error}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
