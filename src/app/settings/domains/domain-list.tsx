"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DESCRIPTION_MAX } from "../_lib/validation";
import { deleteDomain, saveDomain, setDomainActive, type DomainFormValues } from "./actions";

export type DomainRow = {
  id: number;
  name: string;
  description: string;
  keywords: string[];
  excludes: string[];
  arxivCategories: string[];
  venues: string[];
  active: boolean;
  centroidUpdatedAt: string | null;
};

const EMPTY: DomainFormValues = {
  name: "",
  description: "",
  keywords: "",
  excludes: "",
  arxivCategories: "",
  venues: "",
  active: true,
};

function toValues(d: DomainRow): DomainFormValues {
  return {
    name: d.name,
    description: d.description,
    keywords: d.keywords.join(", "),
    excludes: d.excludes.join(", "),
    arxivCategories: d.arxivCategories.join(", "),
    venues: d.venues.join(", "),
    active: d.active,
  };
}

const LIST_FIELDS = [
  { key: "keywords", label: "Keywords", hint: "Comma-separated" },
  { key: "excludes", label: "Exclude terms", hint: "Papers mentioning these are dropped for this domain" },
  { key: "arxivCategories", label: "arXiv categories", hint: "For example cs.CL, cs.IR, stat.ML" },
  { key: "venues", label: "Venues", hint: "For example ACL, CVPR, ICML" },
] as const;

export function DomainList({ domains }: { domains: DomainRow[] }) {
  const [editing, setEditing] = useState<{ id: number | null; values: DomainFormValues } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (id: number | null, values: DomainFormValues) => {
    setError(null);
    setEditing({ id, values });
  };

  const update = <K extends keyof DomainFormValues>(key: K, value: DomainFormValues[K]) =>
    setEditing((current) => (current ? { ...current, values: { ...current.values, [key]: value } } : current));

  const submit = () => {
    if (!editing) return;
    startTransition(async () => {
      const result = await saveDomain(editing.id, editing.values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
      setNotice(result.warning ?? `Saved "${editing.values.name.trim()}".`);
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setNotice(result.ok ? null : (result.error ?? "Something went wrong."));
    });

  const descriptionLength = editing?.values.description.trim().length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
        <Button onClick={() => open(null, EMPTY)}>Add domain</Button>
      </div>

      {domains.length === 0 && <p className="text-sm text-muted-foreground">No domains yet.</p>}

      {domains.map((d) => (
        <Card key={d.id} size="sm">
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-base font-medium">{d.name}</h2>
              {!d.active && <Badge variant="secondary">Paused</Badge>}
              {!d.centroidUpdatedAt && <Badge variant="destructive">No centroid</Badge>}
              <div className="ml-auto flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">
                  Active
                  <Switch
                    size="sm"
                    checked={d.active}
                    disabled={pending}
                    onCheckedChange={(checked) => run(() => setDomainActive(d.id, checked))}
                  />
                </Label>
                <Button variant="outline" size="sm" onClick={() => open(d.id, toValues(d))}>
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete "${d.name}"? Its paper matches are removed too.`)) {
                      run(() => deleteDomain(d.id));
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
            <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
              {LIST_FIELDS.map(({ key, label }) =>
                d[key].length > 0 ? (
                  <div key={key} className="contents">
                    <dt className="micro">{label}</dt>
                    <dd>{d[key].join(", ")}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </CardContent>
        </Card>
      ))}

      <Dialog open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id === null ? "Add domain" : "Edit domain"}</DialogTitle>
            <DialogDescription>Saving recomputes the centroid used to match papers.</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="domain-name">Name</Label>
                <Input
                  id="domain-name"
                  value={editing.values.name}
                  onChange={(e) => update("name", e.target.value)}
                  required
                  maxLength={80}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="domain-description">Description</Label>
                <Textarea
                  id="domain-description"
                  value={editing.values.description}
                  onChange={(e) => update("description", e.target.value)}
                  rows={3}
                  aria-invalid={descriptionLength > DESCRIPTION_MAX}
                />
                <p className={descriptionLength > DESCRIPTION_MAX ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                  {descriptionLength}/{DESCRIPTION_MAX}
                </p>
              </div>
              {LIST_FIELDS.map(({ key, label, hint }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`domain-${key}`}>{label}</Label>
                  <Input
                    id={`domain-${key}`}
                    value={editing.values[key]}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={hint}
                  />
                </div>
              ))}
              <Label className="flex items-center gap-2">
                <Switch checked={editing.values.active} onCheckedChange={(checked) => update("active", checked)} />
                Active
              </Label>
              <p role="alert" className="min-h-5 text-sm text-destructive">
                {error}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
