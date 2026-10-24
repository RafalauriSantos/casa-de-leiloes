import { z } from 'zod';

/** A blank value (as in a copied .env.example) means "not set". Spaces and a newline around a value are not part of it. */
const blankIsUnset = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** The token goes to this address, so it must be encrypted: https, or http only on this machine. */
const isSafeAddress = (address: string) => {
  const { protocol, hostname } = new URL(address);
  return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
};

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    SUPABASE_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
    AUDIT_HMAC_SECRET: z.string().min(32),
    CRON_SECRET: z.string().min(16),
    // The public catalog API. Optional: it has a default, and tests point it at a local stub.
    MET_API_URL: z.url().default('https://collectionapi.metmuseum.org/public/collection'),
    // The public anchor of the bid-chain head (D21). The mode has no default on purpose: forgetting it must
    // stop the server, not switch the anchor off unnoticed. `off` is for local development and tests.
    ANCHOR_MODE: z.enum(['github', 'off']),
    ANCHOR_GITHUB_REPO: z.preprocess(blankIsUnset, z.string().regex(/^[A-Za-z0-9_-][\w.-]*\/[A-Za-z0-9_-][\w.-]*$/).optional()),
    ANCHOR_GITHUB_TOKEN: z.preprocess(blankIsUnset, z.string().min(1).optional()),
    ANCHOR_GITHUB_API_URL: z.preprocess(blankIsUnset, z.url().refine(isSafeAddress, 'must be https, or http on localhost').default('https://api.github.com')),
    ANCHOR_GITHUB_BRANCH: z.preprocess(blankIsUnset, z.string().min(1).default('main')),
  })
  .superRefine((env, ctx) => {
    if (env.ANCHOR_MODE !== 'github') return;
    for (const name of ['ANCHOR_GITHUB_REPO', 'ANCHOR_GITHUB_TOKEN'] as const) {
      if (env[name] === undefined) ctx.addIssue({ code: 'custom', path: [name], message: 'required when ANCHOR_MODE is github' });
    }
  });

export type AnchorConfig = { mode: 'off' } | { mode: 'github'; repo: string; token: string; apiUrl: string; branch: string };

export interface Config {
  databaseUrl: string;
  supabaseUrl: string;
  auditHmacSecret: string;
  cronSecret: string;
  metApiUrl: string;
  anchor: AnchorConfig;
}

function anchorConfig(env: z.infer<typeof schema>): AnchorConfig {
  if (env.ANCHOR_MODE === 'off') return { mode: 'off' };
  // The schema already requires both in this mode. If that ever changes, stop: never turn the anchor off here.
  if (env.ANCHOR_GITHUB_REPO === undefined || env.ANCHOR_GITHUB_TOKEN === undefined) {
    throw new Error('Invalid environment, check: ANCHOR_GITHUB_REPO, ANCHOR_GITHUB_TOKEN');
  }
  return { mode: 'github', repo: env.ANCHOR_GITHUB_REPO, token: env.ANCHOR_GITHUB_TOKEN, apiUrl: env.ANCHOR_GITHUB_API_URL.replace(/\/+$/, ''), branch: env.ANCHOR_GITHUB_BRANCH };
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
    anchor: anchorConfig(parsed.data),
  };
}
