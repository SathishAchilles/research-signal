export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="plate rounded-tile p-4">
      <div className="font-display text-[32px] leading-none num">{value}</div>
      <div className="micro mt-2">{label}</div>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
