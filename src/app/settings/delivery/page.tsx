import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { DeliveryForm } from "./delivery-form";

async function Delivery() {
  await connection();
  const [row] = await db
    .select({
      recipients: appSettings.recipients,
      sendLocalTime: appSettings.sendLocalTime,
      timezone: appSettings.timezone,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!row) return <p className="text-sm text-destructive">Settings row is missing; run npm run seed.</p>;
  return (
    <DeliveryForm
      initial={{ recipients: row.recipients.join("\n"), sendLocalTime: row.sendLocalTime, timezone: row.timezone }}
      timezones={Intl.supportedValuesOf("timeZone")}
    />
  );
}

export default function DeliveryPage() {
  return (
    // Helper text inside the form reads at 14px below lg.
    <section className="plate flex w-full max-w-md flex-col gap-4 p-5 touch:[&_p.text-xs]:text-sm">
      <div>
        <h2 className="micro">Delivery</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The weekly brief is sent on Monday at this local time to every recipient.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading delivery settings…</p>}>
        <Delivery />
      </Suspense>
    </section>
  );
}
