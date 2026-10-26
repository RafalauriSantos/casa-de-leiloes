import { useState, type SyntheticEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { signIn, signUp } from '../api';
import { useAuth } from '../auth-context';

type Mode = 'signin' | 'signup';

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function AuthPanel() {
  const [mode, setMode] = useState<Mode>('signin');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const auth = useAuth();

  if (auth.status === 'signed-in') return <Navigate to="/" replace />;

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = field(form, 'email');
    const password = field(form, 'password');
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const role = field(form, 'role') === 'auctioneer' ? 'auctioneer' : 'bidder';
    const result = mode === 'signin' ? await signIn(email, password) : await signUp(email, password, field(form, 'displayName'), role);
    setBusy(false);
    if (!result.ok) setError(result.message);
    else if ('notice' in result) setNotice(result.notice);
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} aria-labelledby="auth-title">
      <h2 id="auth-title">{mode === 'signin' ? 'Entrar' : 'Criar conta de licitante'}</h2>
      {mode === 'signup' && (
        <>
          <label>
            Nome
            <input name="displayName" required autoComplete="name" />
          </label>
          <fieldset>
            <legend>Como você vai usar a casa de leilões?</legend>
            <label>
              <input type="radio" name="role" value="bidder" defaultChecked />
              Quero comprar
            </label>
            <label>
              <input type="radio" name="role" value="auctioneer" />
              Quero vender
            </label>
          </fieldset>
        </>
      )}
      <label>
        E-mail
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Senha
        <input name="password" type="password" required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
      </label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
      </button>
      <button type="button" className="link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(undefined); }}>
        {mode === 'signin' ? 'Não tenho conta' : 'Já tenho conta'}
      </button>
    </form>
  );
}
