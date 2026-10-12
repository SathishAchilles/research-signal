import { db } from "@/db/client";
import { getEnabledSources, getSourceSecret, registry } from "@/lib/sources/registry";
import { S2_THROTTLED } from "@/lib/sources/s2";

// Exits non-zero when any enabled source fails. A throttled anonymous S2 pool is only a warning.
export default async function run() {
  try {
    let failed = 0;
    let warned = 0;
    for (const source of await getEnabledSources()) {
      const secret = await getSourceSecret(source.kind);
      const result = await registry[source.kind].testConnection(source.params, secret);
      const warning = source.kind === "s2" && result.ok && result.sample === S2_THROTTLED;
      if (!result.ok) failed++;
      if (warning) warned++;
      const detail = warning
        ? `warning: ${S2_THROTTLED}`
        : result.ok
          ? `sample: ${result.sample ?? "(none)"}`
          : `error: ${result.error}`;
      console.log(`${source.kind.padEnd(10)} ok=${result.ok} latency=${result.latencyMs} ms ${detail}`);
    }
    if (warned) console.log(`${warned} source(s) with warnings`);
    if (failed) {
      console.log(`${failed} source(s) failed`);
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}
