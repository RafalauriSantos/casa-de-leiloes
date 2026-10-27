import type { ReceiptView } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { fetchReceipt } from '../api';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; receipt: ReceiptView };

const closedAt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** The win receipt, public by its code: the link the winner shares opens it without login. */
export function ReceiptLoader({ code }: { code: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchReceipt(code)
      .then((receipt) => { if (!cancelled) setState({ status: 'ready', receipt }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [code]);

  return (
    <section aria-label="Comprovante">
      <h1>Comprovante de arremate</h1>
      {state.status === 'loading' && <p>Carregando o comprovante…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <div className="receipt">
          <svg className="receipt-seal" viewBox="0 0 76 76" aria-hidden="true" fill="none">
            <circle cx="38" cy="38" r="35" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="38" cy="38" r="29" stroke="currentColor" strokeWidth="1" />
            <path d="M38 20l18 18-18 18-18-18z" fill="currentColor" />
          </svg>
          <img className="lot-hero" src={state.receipt.imageUrl} alt={state.receipt.lotTitle} />
          <h2>{state.receipt.lotTitle}</h2>
          <strong className="receipt-amount">{formatBRL(state.receipt.amountCents)}</strong>
          <dl>
            <div><dt>Liquidado em</dt><dd>{closedAt(state.receipt.closedAt)}</dd></div>
            <div><dt>Vencedor</dt><dd>{state.receipt.winnerLabel}</dd></div>
            <div><dt>Código</dt><dd><code>{state.receipt.code}</code></dd></div>
          </dl>
          <div className="receipt-actions">
            <Link to={`/auditoria/${state.receipt.lotId}?head=${state.receipt.headHash}`}>Conferir na auditoria</Link>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(window.location.href); }}>Copiar link</button>
          </div>
          <p className="audit-note">Qualquer pessoa com este link vê o comprovante, sem entrar na conta.</p>
        </div>
      )}
    </section>
  );
}
