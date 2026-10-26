import type { LotSummary } from '@casa/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LotCard } from './LotCard';

afterEach(cleanup);

const lot = (state: LotSummary['state']): LotSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Relógio de bolso',
  imageUrl: 'https://example.test/relogio.jpg',
  startsAt: '2026-10-25T10:00:00Z',
  endsAt: '2026-10-26T10:00:00Z',
  startingBidCents: 50_000,
  incrementCents: 5_000,
  state,
  currentAmountCents: null,
});

const renderCard = (state: LotSummary['state']) =>
  render(<MemoryRouter><LotCard lot={lot(state)} /></MemoryRouter>);

describe('lot card: a live lot is evident, like a live badge on a video platform', () => {
  it('shows an AO VIVO badge with a pulsing dot while the lot is live', () => {
    renderCard('live');
    const badge = screen.getByText('AO VIVO').closest('.live-badge');
    expect(badge).not.toBeNull();
    expect(badge?.querySelector('.live-dot')).not.toBeNull();
  });

  it('keeps the plain state label for every other state, with no live badge', () => {
    for (const [state, label] of [['scheduled', 'Agendado'], ['ended', 'Encerrado'], ['cancelled', 'Cancelado']] as const) {
      const { unmount } = renderCard(state);
      expect(screen.getByText(label).classList.contains('state')).toBe(true);
      expect(document.querySelector('.live-badge')).toBeNull();
      unmount();
    }
  });
});
