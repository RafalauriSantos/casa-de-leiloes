/** The limits of the audit's reads of GitHub (D22). The defaults are the production values; tests pass shorter ones. */
export interface AuditOptions {
  /** How long the (anchored_seq, file) pair of a lot is reused. */
  cacheMs: number;
  /** At most this many GitHub calls a minute for audits, on one server instance. */
  callsPerMinute: number;
  /** All the GitHub work of one request shares this time; after it the re-read and the branch check are skipped. */
  budgetMs: number;
  /** The wait before a divergence is checked again with a fresh read. */
  rereadWaitMs: number;
}

export const DEFAULT_AUDIT_OPTIONS: AuditOptions = { cacheMs: 30_000, callsPerMinute: 30, budgetMs: 8_000, rereadWaitMs: 1_000 };
