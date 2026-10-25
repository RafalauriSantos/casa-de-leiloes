import { AnchorError, confirmBranch, DEFAULT_TIMEOUT_MS, MAX_ANCHOR_FILE_BYTES, parseAnchorFile, readAnchorFile, type GithubTarget } from '../anchor';
import type { AuditOptions } from './options';

/** What one read of the anchor gave: the pair it was read as, a file that contradicts itself, or nothing readable. */
export type AnchorRead = { kind: 'ok'; anchoredSeq: number; held: ReadonlyMap<number, string> } | { kind: 'malformed' } | { kind: 'unavailable' };

export interface AnchorReader {
  /**
   * Reads the anchor file of a lot. `anchoredSeq` is what the lot said just before, so the pair is read in the order D22 needs
   * and is cached together. A fresh read never uses the cache. Every GitHub call counts against the limit and the deadline.
   */
  read: (lotId: string, anchoredSeq: number, deadlineMs: number, fresh: boolean) => Promise<AnchorRead>;
}

const MINUTE_MS = 60_000;

/** The reader of one server instance: its cache and its call count live here, not in the module. */
export function createAnchorReader(target: GithubTarget, options: AuditOptions): AnchorReader {
  const cache = new Map<string, { anchoredSeq: number; held: ReadonlyMap<number, string>; at: number }>();
  const calls: number[] = [];

  const takeCall = (): boolean => {
    const now = Date.now();
    while (calls.length > 0 && now - (calls[0] ?? now) >= MINUTE_MS) calls.shift();
    if (calls.length >= options.callsPerMinute) return false;
    calls.push(now);
    return true;
  };

  /** One call to GitHub: refused when the budget is spent or the limit reached, and never longer than what is left of the budget. */
  const call = <T>(deadlineMs: number, run: (limited: GithubTarget) => Promise<T>): Promise<T> => {
    const left = deadlineMs - Date.now();
    if (left <= 0 || !takeCall()) return Promise.reject(new AnchorError('unavailable', 'The audit has no time or no calls left for GitHub.'));
    return run({ ...target, timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, left) });
  };

  return {
    read: async (lotId, anchoredSeq, deadlineMs, fresh) => {
      const cached = cache.get(lotId);
      if (!fresh && cached && Date.now() - cached.at < options.cacheMs) return { kind: 'ok', anchoredSeq: cached.anchoredSeq, held: cached.held };
      try {
        const file = await call(deadlineMs, (limited) => readAnchorFile(limited, `lots/${lotId}.csv`));
        let held: ReadonlyMap<number, string>;
        if (file === null) {
          // A 404 is believed only when the repository and the branch are confirmed: GitHub also says 404 for a wrong repository, branch or token.
          await call(deadlineMs, (limited) => confirmBranch(limited));
          held = new Map();
        } else {
          if (Buffer.byteLength(file.content, 'utf8') > MAX_ANCHOR_FILE_BYTES) throw new AnchorError('too_large', 'The anchor file is too large to read.');
          held = parseAnchorFile(file.content, lotId);
        }
        const now = Date.now();
        for (const [key, entry] of cache) if (now - entry.at >= options.cacheMs) cache.delete(key);
        cache.set(lotId, { anchoredSeq, held, at: now });
        return { kind: 'ok', anchoredSeq, held };
      } catch (error) {
        // What the publisher calls integrity is a file that contradicts itself; every other failure means nothing was read.
        if (error instanceof AnchorError && error.kind === 'integrity') return { kind: 'malformed' };
        // The kind only: neither the message nor the token ever goes to the log.
        console.error(`audit: the anchor could not be read (${error instanceof AnchorError ? error.kind : 'unexpected'})`);
        return { kind: 'unavailable' };
      }
    },
  };
}
