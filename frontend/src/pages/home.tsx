import { AuthPanel, MeCard, useSession } from '@/features/auth';

export function HomePage() {
  const session = useSession();

  return (
    <main>
      <h1>Casa de Leilões</h1>
      {session.status === 'loading' && <p>Carregando…</p>}
      {session.status === 'signed-out' && <AuthPanel />}
      {session.status === 'signed-in' && <MeCard token={session.session.access_token} />}
    </main>
  );
}
