import type { ReactNode } from "react";

export function SpecTable({
  rows,
  caption,
}: {
  rows: [label: string, value: ReactNode][];
  caption?: string;
}) {
  const list = (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="micro">{label}</dt>
          <dd className="text-sm num">{value}</dd>
        </div>
      ))}
    </dl>
  );

  if (!caption) return list;

  return (
    <figure>
      <figcaption className="micro mb-3">{caption}</figcaption>
      {list}
    </figure>
  );
}
