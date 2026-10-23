import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth';

export function HomePage() {
  const auth = useAuth();

  return (
    <section>
      <h1>Casa de Leilões</h1>
      {auth.status === 'loading' && <p>Carregando…</p>}
      {auth.status === 'error' && <p role="alert">{auth.message}</p>}
      {auth.status === 'signed-out' && (
        <p>
          Dê lances em lotes ao vivo e acompanhe a auditoria de cada leilão. <Link to="/entrar">Entre ou crie sua conta</Link> para participar.
        </p>
      )}
      {auth.status === 'signed-in' && (
        <p>
          Olá, <strong>{auth.me.displayName}</strong>.{' '}
          {auth.me.role === 'bidder' ? <Link to="/carteira">Ver minha carteira</Link> : 'Seu painel de leiloeiro chega na próxima etapa.'}
        </p>
      )}
    </section>
  );
}
