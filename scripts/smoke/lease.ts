import { db } from "@/db/client";
import { ARXIV_MIN_INTERVAL_MS, withArxivLease } from "@/lib/sources/lease";
import { sleep } from "@/lib/sources/types";

export default async function run() {
  try {
    const hold = (name: string) =>
      withArxivLease(name, async () => {
        await sleep(1500);
        return name;
      });
    const results = await Promise.all([hold("smoke-a"), hold("smoke-b")]);
    console.log(`concurrent: ${results.join(", ")}`);
    if (results.filter((r) => r === "busy").length !== 1) throw new Error("expected exactly one busy result");

    // wait() spaces requests inside one lease; the lease is then held for the interval after release.
    const spacing = await withArxivLease("smoke-spacing", async (wait) => {
      await wait();
      const first = Date.now();
      await wait();
      return Date.now() - first;
    });
    console.log(`spacing between two wait() calls: ${spacing} ms`);
    if (spacing === "busy" || spacing < ARXIV_MIN_INTERVAL_MS - 5) throw new Error("wait() did not enforce the interval");

    const immediate = await withArxivLease("smoke-next", async () => "acquired");
    const waited = await withArxivLease("smoke-next", async () => "acquired", { maxWaitMs: 5000 });
    console.log(`right after release: ${immediate}; with maxWaitMs 5000: ${waited}`);
    if (immediate !== "busy" || waited !== "acquired") throw new Error("release did not hold the interval");
  } finally {
    await db.$client.end();
  }
}
