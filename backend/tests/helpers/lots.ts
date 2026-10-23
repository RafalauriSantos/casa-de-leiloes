import { randomUUID } from 'node:crypto';
import { promoteToAuctioneer, signUpUser, type TestUser } from './auth';
import type { TestServer } from './server';

export async function createAuctioneer(server: TestServer): Promise<TestUser> {
  const user = await signUpUser({ displayName: `Leiloeiro ${randomUUID().slice(0, 4)}` });
  await promoteToAuctioneer(server.db, user.id);
  return user;
}

/** Times are relative to the database clock; the tests read it so they never trust this machine's clock. */
export async function dbNow(server: TestServer): Promise<Date> {
  const [row] = await server.db.query<{ now: Date }>('select clock_timestamp() as now');
  if (!row) throw new Error('database clock unavailable');
  return row.now;
}

export const minutes = (n: number) => n * 60_000;

export function lotBody(now: Date, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    externalId: '205482',
    title: 'Vaso Sèvres Indien',
    startsAt: new Date(now.getTime() + minutes(10)).toISOString(),
    endsAt: new Date(now.getTime() + minutes(70)).toISOString(),
    startingBidCents: 50_000,
    incrementCents: 5_000,
    ...overrides,
  };
}
