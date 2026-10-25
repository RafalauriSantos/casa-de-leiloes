import { z } from 'zod';

/**
 * Client of the GitHub Contents API, for the public anchor repository (D21). It reads one file and
 * writes one file. Every failure becomes an AnchorError with a kind the publisher can act on; none of
 * them carries the token, and an answer that is not what GitHub documents is a failure, never a success.
 */
/** One call may take this long. Two calls per lot and a run budget of 5 s keep a run under the 20 s the per-minute job waits. */
export const DEFAULT_TIMEOUT_MS = 4_000;

export interface GithubTarget {
  repo: string;
  token: string;
  apiUrl: string;
  branch: string;
  /** Per-call time limit; the default fits the per-minute job. */
  timeoutMs?: number;
}

export type AnchorErrorKind = 'conflict' | 'auth' | 'rate_limit' | 'unavailable' | 'integrity' | 'too_large';

export class AnchorError extends Error {
  constructor(
    readonly kind: AnchorErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AnchorError';
  }
}

// Only base64 content is a file we can read back. GitHub answers "none" with an empty content for a file over 1 MB.
const fileBody = z.object({ sha: z.string().min(1), content: z.string(), encoding: z.literal('base64') });

interface Answer {
  status: number;
  headers: Headers;
  body: unknown;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** One call to the GitHub API, `repoPath` being what follows `/repos/{repo}` (for example `/contents/lots/x.csv?ref=main`). */
async function call(target: GithubTarget, method: 'GET' | 'PUT', repoPath: string, body?: Record<string, unknown>): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(`${target.apiUrl}/repos/${target.repo}${repoPath}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${target.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'casa-de-leiloes-anchor',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A redirect is never followed: the token goes only to the configured address.
      redirect: 'error',
      signal: AbortSignal.timeout(target.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new AnchorError('unavailable', 'GitHub could not be reached.');
  }
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => undefined) };
}

/** Names the failure from the status. The message holds the status only: no body, no token. */
function failure(answer: Answer): AnchorError {
  const { status } = answer;
  if (status === 401) return new AnchorError('auth', 'GitHub refused the token (401).');
  const limited = answer.headers.get('x-ratelimit-remaining') === '0' || answer.headers.has('retry-after');
  if (status === 429 || (status === 403 && limited)) {
    return new AnchorError('rate_limit', `GitHub is limiting requests (${String(status)}).`);
  }
  if (status === 403) {
    // Written from memory of GitHub's behaviour, not from its documentation: a file too large to read comes as 403 "too_large".
    const code = z.object({ errors: z.array(z.object({ code: z.string() })).min(1) }).safeParse(answer.body);
    if (code.success && code.data.errors[0]?.code === 'too_large') return new AnchorError('too_large', 'GitHub cannot read the anchor file: it is too large (403).');
    return new AnchorError('auth', 'GitHub refused the access (403).');
  }
  // A write to a repository, a branch or a path that GitHub does not find, or that the token cannot see.
  if (status === 404) return new AnchorError('auth', 'GitHub did not find the repository or the branch, or the token has no access (404).');
  if (status === 409 || status === 422) return new AnchorError('conflict', `The anchor file changed or already exists (${String(status)}).`);
  return new AnchorError('unavailable', `GitHub answered ${String(status)}.`);
}

export interface AnchorFile {
  sha: string;
  content: string;
}

/** The file as it is now, or null when it does not exist yet. */
export async function readAnchorFile(target: GithubTarget, path: string): Promise<AnchorFile | null> {
  const answer = await call(target, 'GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(target.branch)}`);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw failure(answer);
  const parsed = fileBody.safeParse(answer.body);
  if (!parsed.success) throw new AnchorError('unavailable', 'GitHub answered with an unexpected body.');
  return { sha: parsed.data.sha, content: Buffer.from(parsed.data.content.replace(/\n/g, ''), 'base64').toString('utf8') };
}

/** Creates the file (no sha) or updates it (the sha that was read). A stale sha is a conflict. */
export async function writeAnchorFile(target: GithubTarget, path: string, content: string, sha: string | undefined, message: string): Promise<void> {
  const answer = await call(target, 'PUT', `/contents/${encodePath(path)}`, {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: target.branch,
    ...(sha === undefined ? {} : { sha }),
  });
  if (answer.status !== 200 && answer.status !== 201) throw failure(answer);
}

/**
 * Confirms that the repository and the branch exist and the token can see them. GitHub answers 404 for a file that
 * is missing, but also for a wrong repository, a wrong branch or a token without access, so a missing file is only
 * believed after this call succeeds. Any other answer throws, and a 404 here is named `auth`, as for a write.
 */
export async function confirmBranch(target: GithubTarget): Promise<void> {
  const answer = await call(target, 'GET', `/branches/${encodeURIComponent(target.branch)}`);
  if (answer.status !== 200) throw failure(answer);
}
