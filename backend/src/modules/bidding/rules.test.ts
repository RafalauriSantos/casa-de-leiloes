import { describe, expect, it } from 'vitest';
import { ANTI_SNIPING_WINDOW_MS, decideBid, type BidLot, type BidVerdict } from './rules';

const messageOf = (verdict: BidVerdict): string => (verdict.ok ? '' : verdict.message);

const at = (ms: number) => new Date(Date.UTC(2030, 0, 1, 12, 0, 0) + ms);
const MIN = 60_000;

const open: BidLot = {
  startsAt: at(0),
  endsAt: at(60 * MIN),
  cancelled: false,
  startingBidCents: 50_000,
  incrementCents: 5_000,
  currentAmountCents: null,
  leaderId: null,
};
const now = at(10 * MIN);
const wallet = { totalCents: 1_000_000, committedCents: 0 };
const bid = (amountCents: number, bidderId = 'ana') => ({ bidderId, amountCents });

describe('lot state gates the bid', () => {
  it('refuses a cancelled lot', () => {
    expect(decideBid({ ...open, cancelled: true }, wallet, bid(50_000), now)).toMatchObject({ ok: false, code: 'lot_cancelled' });
  });

  it('refuses a lot that has not started', () => {
    expect(decideBid(open, wallet, bid(50_000), at(-1))).toMatchObject({ ok: false, code: 'lot_not_started' });
  });

  it('refuses a lot that has ended, at the very end (end is exclusive)', () => {
    expect(decideBid(open, wallet, bid(50_000), open.endsAt)).toMatchObject({ ok: false, code: 'lot_ended' });
  });

  it('accepts a bid one millisecond before the end', () => {
    expect(decideBid(open, wallet, bid(50_000), new Date(open.endsAt.getTime() - 1))).toMatchObject({ ok: true });
  });

  it('accepts a bid at the exact start (start is inclusive)', () => {
    expect(decideBid(open, wallet, bid(50_000), open.startsAt)).toMatchObject({ ok: true });
  });
});

describe('minimum amount', () => {
  it('the first bid must be at least the starting bid', () => {
    expect(decideBid(open, wallet, bid(50_000), now)).toMatchObject({ ok: true });
    const refused = decideBid(open, wallet, bid(49_999), now);
    expect(refused).toMatchObject({ ok: false, code: 'bid_below_minimum' });
    expect(messageOf(refused)).toContain('R$ 500,00');
  });

  it('later bids must be at least the current amount plus the increment', () => {
    const lot = { ...open, currentAmountCents: 80_000, leaderId: 'bruno' };
    expect(decideBid(lot, wallet, bid(85_000), now)).toMatchObject({ ok: true });
    expect(decideBid(lot, wallet, bid(84_999), now)).toMatchObject({ ok: false, code: 'bid_below_minimum' });
  });

  it('the refusal states the exact minimum in reais', () => {
    const lot = { ...open, currentAmountCents: 80_000, leaderId: 'bruno' };
    const refused = decideBid(lot, wallet, bid(10_000), now);
    expect(messageOf(refused)).toContain('R$ 850,00');
  });
});

describe('leader cannot outbid itself', () => {
  it('refuses the current leader with already_leading, whatever the amount', () => {
    const lot = { ...open, currentAmountCents: 80_000, leaderId: 'ana' };
    expect(decideBid(lot, wallet, bid(900_000, 'ana'), now)).toMatchObject({ ok: false, code: 'already_leading' });
    expect(decideBid(lot, wallet, bid(1, 'ana'), now)).toMatchObject({ ok: false, code: 'already_leading' });
  });
});

describe('funds: the available balance must cover the bid', () => {
  it('accepts a bid that exactly uses the available balance', () => {
    expect(decideBid(open, { totalCents: 50_000, committedCents: 0 }, bid(50_000), now)).toMatchObject({ ok: true });
  });

  it('refuses a bid one cent over the available balance', () => {
    expect(decideBid(open, { totalCents: 50_000, committedCents: 0 }, bid(50_001), now)).toMatchObject({ ok: false, code: 'insufficient_funds' });
  });

  it('counts money already committed elsewhere as unavailable', () => {
    expect(decideBid(open, { totalCents: 100_000, committedCents: 60_000 }, bid(50_000), now)).toMatchObject({ ok: false, code: 'insufficient_funds' });
  });
});

describe('the outbid leader is released', () => {
  it('reports the previous leader and the amount to release', () => {
    const lot = { ...open, currentAmountCents: 80_000, leaderId: 'bruno' };
    expect(decideBid(lot, wallet, bid(85_000, 'ana'), now)).toMatchObject({ ok: true, releasedLeaderId: 'bruno', releasedCents: 80_000 });
  });

  it('releases nothing on the first bid', () => {
    expect(decideBid(open, wallet, bid(50_000), now)).toMatchObject({ ok: true, releasedLeaderId: null, releasedCents: 0 });
  });
});

describe('anti-sniping: a bid in the last two minutes extends the end', () => {
  const window = ANTI_SNIPING_WINDOW_MS;

  it('does not extend a bid made more than two minutes before the end', () => {
    const verdict = decideBid(open, wallet, bid(50_000), new Date(open.endsAt.getTime() - window - 1));
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.ok && verdict.newEndsAt.getTime()).toBe(open.endsAt.getTime());
  });

  it('extends a bid made exactly two minutes before the end', () => {
    const at2min = new Date(open.endsAt.getTime() - window);
    const verdict = decideBid(open, wallet, bid(50_000), at2min);
    expect(verdict.ok && verdict.newEndsAt.getTime()).toBe(at2min.getTime() + window);
  });

  it('sets the new end to now plus two minutes when that is later than the current end', () => {
    const late = new Date(open.endsAt.getTime() - 30_000);
    const verdict = decideBid(open, wallet, bid(50_000), late);
    expect(verdict.ok && verdict.newEndsAt.getTime()).toBe(late.getTime() + window);
  });

  it('never shortens the lot: a late bid keeps the end when the end is already further than now plus two minutes', () => {
    const lot = { ...open, endsAt: new Date(open.endsAt.getTime() + 10 * MIN) };
    const late = new Date(lot.endsAt.getTime() - 60_000);
    const verdict = decideBid(lot, wallet, bid(50_000), late);
    // Now plus two minutes is later than the end here, so the end moves; it is never earlier than before.
    expect(verdict.ok && verdict.newEndsAt.getTime()).toBe(late.getTime() + window);
    expect(verdict.ok && verdict.newEndsAt.getTime()).toBeGreaterThan(lot.endsAt.getTime());
  });

  it('keeps the end when a late bid is already more than two minutes before it', () => {
    const lot = { ...open, endsAt: new Date(open.endsAt.getTime() + 10 * MIN) };
    const verdict = decideBid(lot, wallet, bid(50_000), new Date(lot.endsAt.getTime() - 5 * MIN));
    expect(verdict.ok && verdict.newEndsAt.getTime()).toBe(lot.endsAt.getTime());
  });

  it('keeps extending: every late bid moves the end again', () => {
    const first = decideBid(open, wallet, bid(50_000), new Date(open.endsAt.getTime() - 30_000));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const next = { ...open, endsAt: first.newEndsAt, currentAmountCents: 50_000, leaderId: 'ana' };
    const lateAgain = new Date(first.newEndsAt.getTime() - 10_000);
    const second = decideBid(next, wallet, bid(55_000, 'bruno'), lateAgain);
    expect(second.ok && second.newEndsAt.getTime()).toBe(lateAgain.getTime() + window);
  });
});
