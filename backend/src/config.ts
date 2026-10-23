import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  AUDIT_HMAC_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(16),
});

export interface Config {
  databaseUrl: string;
  supabaseUrl: string;
  auditHmacSecret: string;
  cronSecret: string;
}

/** The only place that reads environment variables. Fails on startup; there are no default secrets. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment, check: ${names.join(', ')}`);
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    supabaseUrl: parsed.data.SUPABASE_URL,
    auditHmacSecret: parsed.data.AUDIT_HMAC_SECRET,
    cronSecret: parsed.data.CRON_SECRET,
  };
}
