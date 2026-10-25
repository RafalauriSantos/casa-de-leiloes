import { AnchorError } from './github-client';
import { ANCHOR_HEADER } from './rules';

/** GitHub reads a file of up to 1 MB through this API, and a write of this size must finish inside one call. A bigger file is never rewritten, and the audit does not read it: it is an incident to look at. */
export const MAX_ANCHOR_FILE_BYTES = 600_000;

/**
 * The hashes a file holds, by sequence number. Two different hashes for one bid, or a line of another lot,
 * are an incident.
 */
export function parseAnchorFile(content: string, lotId: string): Map<number, string> {
  const held = new Map<number, string>();
  for (const raw of content.split('\n')) {
    // A file saved on Windows ends its lines with a carriage return; it is not part of the line.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '' || line === ANCHOR_HEADER) continue;
    const fields = line.split(',');
    const [lot, seq, hash] = fields;
    if (fields.length !== 4 || lot !== lotId || seq === undefined || !/^[1-9]\d*$/.test(seq) || hash === undefined) {
      throw new AnchorError('integrity', 'The anchor file of the lot holds a line that is not a bid line of this lot.');
    }
    const number = Number(seq);
    const earlier = held.get(number);
    if (earlier !== undefined && earlier !== hash) {
      throw new AnchorError('integrity', `The anchor file holds two different hashes for bid ${String(number)}.`);
    }
    held.set(number, hash);
  }
  return held;
}
