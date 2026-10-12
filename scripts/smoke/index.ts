import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type SmokeModule = { default?: (args: string[]) => unknown };

const smokeDir = path.resolve(process.cwd(), "scripts/smoke");

function available(): string[] {
  return readdirSync(smokeDir)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .map((file) => file.slice(0, -3))
    .sort();
}

async function main() {
  const [name, ...args] = process.argv.slice(2);

  if (!name || !/^[a-z0-9-]+$/.test(name) || name === "index") {
    const list = available();
    console.error("Usage: npm run smoke -- <name> [args...]");
    console.error(`Available: ${list.length ? list.join(", ") : "(none)"}`);
    process.exit(1);
  }

  const file = path.join(smokeDir, `${name}.ts`);
  if (!existsSync(file)) {
    console.error(`Unknown smoke test "${name}". Available: ${available().join(", ") || "(none)"}`);
    process.exit(1);
  }

  const mod = (await import(pathToFileURL(file).href)) as SmokeModule;
  const run = typeof mod.default === "function"
    ? mod.default
    : (mod.default as SmokeModule | undefined)?.default;
  if (typeof run !== "function") {
    console.error(`scripts/smoke/${name}.ts has no default export function`);
    process.exit(1);
  }

  const started = Date.now();
  await run(args);
  console.log(`smoke:${name} ok in ${Date.now() - started} ms`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});
