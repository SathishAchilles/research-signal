import { readFileSync } from "node:fs";
import path from "node:path";
import type { Intent, RoutedIntent } from "./route-intent";
import type { AskToolName } from "./tools";

const DIR = path.join(process.cwd(), "src/lib/ask");

const cache = new Map<string, string>();
function load(relative: string): string {
  let text = cache.get(relative);
  if (text === undefined) {
    text = readFileSync(path.join(DIR, relative), "utf8").trim();
    cache.set(relative, text);
  }
  return text;
}

const TOOLS: Record<Intent, AskToolName[]> = {
  BET: ["search_index", "get_papers", "trend", "related", "get_fulltext", "live_search"],
  BACKING: ["search_index", "get_papers", "my_log", "get_fulltext", "live_search"],
  DIRECTION: ["search_index", "get_papers", "trend", "live_search"],
  EXPLAIN: ["search_index", "get_papers", "related", "get_fulltext", "live_search"],
  CATCHUP: ["search_index", "get_papers", "trend", "live_search"],
  PREP: ["search_index", "get_papers", "trend", "my_log", "live_search"],
};

const TEMPLATE_FILE: Record<Intent, string> = {
  BET: "templates/bet.md",
  BACKING: "templates/backing.md",
  DIRECTION: "templates/direction.md",
  EXPLAIN: "templates/explain.md",
  CATCHUP: "templates/catchup.md",
  PREP: "templates/prep.md",
};

export const playbooks: Record<Intent, { tools: AskToolName[]; template: string }> = Object.fromEntries(
  (Object.keys(TOOLS) as Intent[]).map((intent) => [
    intent,
    {
      tools: TOOLS[intent],
      get template() {
        return load(TEMPLATE_FILE[intent]);
      },
    },
  ]),
) as Record<Intent, { tools: AskToolName[]; template: string }>;

// A bare term is answered as EXPLAIN followed by CATCHUP.
export function playbookFor(routed: RoutedIntent): { intents: Intent[]; tools: AskToolName[]; template: string } {
  const intents: Intent[] = routed.bareTerm ? ["EXPLAIN", "CATCHUP"] : [routed.intent];
  const tools = [...new Set(intents.flatMap((i) => playbooks[i].tools))];
  const template = intents.map((i) => playbooks[i].template).join("\n\n");
  return { intents, tools, template };
}

export function systemPrompt(
  routed: RoutedIntent,
  template: string,
  intents: Intent[],
  options: { wordCap: number; domainNames: string[]; today: string; toolRounds: number; confidence: string },
): string {
  const values: Record<string, string> = {
    intent: intents.join(" + "),
    entities: routed.entities.join(", ") || "(none)",
    domains: options.domainNames.join(", ") || "(any)",
    since: routed.since ?? "(not given)",
    client: routed.client ?? "(none)",
    today: options.today,
    wordCap: String(options.wordCap),
    toolRounds: String(options.toolRounds),
    confidence: options.confidence,
    template,
  };
  return load("prompts/system.md").replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}
