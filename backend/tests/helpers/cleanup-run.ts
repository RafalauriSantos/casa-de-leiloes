import pg from 'pg';

/**
 * Cancels the unsettled lots created since `since` in the test database, so the next run starts with no open lot.
 * Refuses to touch any database that is not on this machine: a test run must never cancel real lots.
 */
export async function cancelLotsSince(databaseUrl: string | undefined, since: Date): Promise<void> {
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  // pg takes host and hostaddr from the query string before the URL's host, so the query can point elsewhere.
  const target = url.searchParams.get('host') ?? url.searchParams.get('hostaddr') ?? url.hostname;
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr') || (target !== '127.0.0.1' && target !== 'localhost')) {
    console.warn(`cleanup skipped: the test database is not local (${target})`);
    return;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "update public.lots set status = 'cancelled' where status = 'active' and settled_at is null and created_at >= $1",
      [since],
    );
  } finally {
    await client.end();
  }
}
