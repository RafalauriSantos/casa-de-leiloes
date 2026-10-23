import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  AUDIT_HMAC_SECRET: z.string().min(32),
  CRON_SECRET: z.string().min(16),
  // The public catalog API. Optional: it has a default, and tests point it at a local stub.
  MET_API_URL: z.url().default('https://collectionapi.metmuseum.org/public/collection'),
});

export interface Config {
  databaseUrl: string;
  supabaseUrl: string;
  auditHmacSecret: string;
  cronSecret: string;
  metApiUrl: string;
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
    metApiUrl: parsed.data.MET_API_URL.replace(/\/+$/, ''),
  };
}
