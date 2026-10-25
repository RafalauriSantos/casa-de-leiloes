import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Showcase } from './components/Showcase';

afterEach(cleanup);

describe('showcase: the live tab stands out', () => {
  it('marks "Ao vivo" with a live indicator and selects it by default', async () => {
    render(<Showcase />);
    const live = await screen.findByRole('button', { name: 'Ao vivo' });
    expect(live.className).toContain('tab-live');
    expect(live.getAttribute('aria-pressed')).toBe('true');
    expect(live.querySelector('.live-dot')).not.toBeNull();
  });

  it('the other tabs have no live indicator', async () => {
    render(<Showcase />);
    await screen.findByRole('button', { name: 'Ao vivo' });
    expect(screen.getByRole('button', { name: 'Agendados' }).querySelector('.live-dot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Encerrados' }).querySelector('.live-dot')).toBeNull();
  });
});
