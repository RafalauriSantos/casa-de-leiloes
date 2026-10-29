import type { ReceiptView } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBRL } from '@/lib/format';
import { fetchAudit, headlineText, type HeadlineText } from '@/features/audit';
import { fetchReceipt } from '../api';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; receipt: ReceiptView };
/** The audit's own verdict for this receipt's lot, or that the check could not run. */
type HistoryCheck = { status: 'checking' } | { status: 'unknown' } | { status: 'ready'; verdict: HeadlineText };
type Copy = 'copied' | 'refused';

const closedAt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** The win receipt, public by its code: the link the winner shares opens it without login. */
export function ReceiptLoader({ code }: { code: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [history, setHistory] = useState<HistoryCheck>({ status: 'checking' });
  const [copy, setCopy] = useState<Copy>();

  /** Copies the address; a browser that refuses (or has no clipboard, on an insecure page) says so instead of failing silently. */
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopy('copied');
    } catch {
      setCopy('refused');
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchReceipt(code)
      .then((receipt) => {
        if (cancelled) return;
        setState({ status: 'ready', receipt });
        setHistory({ status: 'checking' });
        fetchAudit(receipt.lotId, receipt.headHash)
          .then((report) => { if (!cancelled) setHistory({ status: 'ready', verdict: headlineText(report.headline) }); })
          .catch(() => { if (!cancelled) setHistory({ status: 'unknown' }); });
      })
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
          <h2>{state.receipt.lotTitle}</h2>
          <strong className="receipt-amount">{formatBRL(state.receipt.amountCents)}</strong>
          <dl>
            <div><dt>Liquidado em</dt><dd>{closedAt(state.receipt.closedAt)}</dd></div>
            <div><dt>Vencedor</dt><dd>{state.receipt.winnerLabel}</dd></div>
            <div><dt>Código</dt><dd><code>{state.receipt.code}</code></dd></div>
          </dl>
          <div className="receipt-actions">
            <button
              type="button"
              onClick={() => { void copyLink(); }}
            >
              Copiar link
            </button>
            <Link to={`/auditoria/${state.receipt.lotId}?head=${state.receipt.headHash}`}>Conferir na auditoria</Link>
          </div>
          {copy === 'copied' && <p role="status">Link copiado.</p>}
          {copy === 'refused' && <p role="alert">Não foi possível copiar o link. Copie o endereço da barra do navegador.</p>}
          {history.status === 'ready' && (
            history.verdict.tone === 'danger'
              ? <p role="alert"><strong>{history.verdict.title}.</strong> {history.verdict.detail}</p>
              : <p role="status"><strong>{history.verdict.title}.</strong> {history.verdict.detail}</p>
          )}
          {history.status === 'unknown' && <p role="status">Não foi possível conferir o histórico agora.</p>}
          <p className="audit-note">Qualquer pessoa com este link vê o comprovante, sem entrar na conta.</p>
        </div>
      )}
    </section>
  );
}
