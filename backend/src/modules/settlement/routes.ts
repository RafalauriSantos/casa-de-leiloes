import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Config } from '../../config';
import type { Db } from '../../shared/db';
import { AppError } from '../../shared/errors';
import { ANCHOR_LAST_START_MS, publishPending, type PublishResult } from '../anchor';
import { settleDue } from './service';

function hasCronSecret(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function settlementRoutes(deps: { db: Db; config: Config }): Hono {
  return new Hono().post('/internal/close-due', async (c) => {
    if (!hasCronSecret(c.req.header('Authorization'), deps.config.cronSecret)) {
      throw new AppError('unauthenticated', 'Chamada interna não autorizada.');
    }
    // The settlement run never calls the anchor, so an anchor that fails or hangs cannot stall it; a payment waits only for
    // the lot's `anchored_seq` (D21, option B), which the publisher raises after it has written the file.
    const requestStarted = Date.now();
    const settlement = await settleDue(deps.db, deps.config);
    let anchor: PublishResult;
    try {
      // The per-minute job waits 20 s: the anchor starts no lot after ANCHOR_LAST_START_MS of this request.
      anchor = await publishPending(deps.db, deps.config, { deadlineAtMs: requestStarted + ANCHOR_LAST_START_MS });
    } catch (error) {
      console.error(`anchor: the run failed: ${error instanceof Error ? error.message : 'unexpected error'}`);
      anchor = { mode: deps.config.anchor.mode, published: 0, failed: 1, stale: 0 };
    }
    // Anything that failed, or an anchor head pending for too long, is a failure for the caller, never an HTTP success.
    const failed = settlement.failed > 0 || anchor.failed > 0 || anchor.stale > 0;
    return c.json({ ...settlement, anchor }, failed ? 500 : 200);
  });
}
