import { describe, expect, it } from 'vitest';
import { signUpOutcome } from './api';

describe('signUpOutcome', () => {
  it('opens the session when the project signs the user in at once', () => {
    expect(signUpOutcome({ hasError: false, hasSession: true })).toEqual({ ok: true });
  });

  it('asks to confirm the e-mail (as a notice, not an error) when there is no session yet', () => {
    expect(signUpOutcome({ hasError: false, hasSession: false })).toEqual({ ok: true, notice: expect.stringContaining('Confirme o e-mail') as string });
  });

  it('gives one generic refusal for any sign-up error', () => {
    expect(signUpOutcome({ hasError: true, hasSession: false })).toEqual({ ok: false, message: 'Não foi possível criar a conta com esses dados.' });
  });
});
