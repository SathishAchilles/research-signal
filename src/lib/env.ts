import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const required = z.preprocess(emptyToUndefined, z.string().min(1));
const optional = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const postgresUrl = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL"),
);
const secret = z.preprocess(
  emptyToUndefined,
  z.string().min(32, "must be at least 32 characters"),
);

const schema = z.object({
  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl,
  DATABASE_ADMIN_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL")
      .optional(),
  ),
  OPENROUTER_API_KEY: z.preprocess(
    emptyToUndefined,
    z.string().startsWith("sk-or-v1-", "must start with sk-or-v1-"),
  ),
  RESEND_API_KEY: required,
  RESEND_FROM: required,
  SESSION_SECRET: secret,
  ACTION_LINK_SECRET: secret,
  CRON_SECRET: secret,
  APP_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("https://research-signal.vercel.app"),
  ),
  CONTACT_EMAIL: z.preprocess(
    emptyToUndefined,
    z.email().default("sathshh@gmail.com"),
  ),
  HF_TOKEN: optional,
  CORE_API_KEY: optional,
});

export type Env = z.infer<typeof schema>;

function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "(root)");
    return source[name] === undefined || source[name]?.trim() === ""
      ? `${name} (missing)`
      : `${name} (${issue.message})`;
  });
  throw new Error(`Invalid environment variables: ${problems.join(", ")}`);
}

export const env: Env = parseEnv(process.env);
