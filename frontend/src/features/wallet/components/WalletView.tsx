import { useWallet } from '../hooks/use-wallet';
import { DepositForm } from './DepositForm';
import { WalletSummary } from './WalletSummary';

export function WalletView({ token }: { token: string }) {
  const { state, setWallet, reload } = useWallet(token);

  return (
    <section aria-label="Carteira">
      <h1>Carteira</h1>
      {state.status === 'loading' && <p>Carregando saldos…</p>}
      {state.status === 'error' && (
        <>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={reload}>Tentar de novo</button>
        </>
      )}
      {state.status === 'ready' && <WalletSummary wallet={state.wallet} />}
      <DepositForm token={token} onDeposited={setWallet} />
    </section>
  );
}
