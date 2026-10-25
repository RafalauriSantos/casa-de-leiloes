import type { AuditReport } from '@casa/contracts';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api-client';
import { fetchAudit } from '../api';
import { AuditView } from './AuditView';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; report: AuditReport };

/** The page of one lot's audit: the lot from the address, the receipt head from `?head=`. Public, read-only. */
export function AuditLoader({ lotId }: { lotId: string }) {
  const [params, setParams] = useSearchParams();
  const head = params.get('head') ?? undefined;
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchAudit(lotId, head)
      .then((report) => { if (!cancelled) setState({ status: 'ready', report }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof ApiRequestError ? error.message : 'Erro inesperado.' });
      });
    return () => { cancelled = true; };
  }, [lotId, head]);

  return (
    <section aria-label="Auditoria">
      <h1>Auditoria do lote</h1>
      {state.status === 'loading' && <p>Carregando auditoria…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && (
        <AuditView
          report={state.report}
          head={head}
          onHead={(next) => { setParams(next === '' ? {} : { head: next }); }}
        />
      )}
    </section>
  );
}
