import type { AuditReport } from '@casa/contracts';
import { useState, type SyntheticEvent } from 'react';
import { formatBRL } from '@/lib/format';
import { anchorText, chainText, headlineText, receiptText } from '../texts';

const SECOND = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' });

/** The audit of a lot, from the server's answer: the headline, the three results, the receipt form and every bid. */
export function AuditView({ report, head, onHead }: { report: AuditReport; head: string | undefined; onHead: (head: string) => void }) {
  const [typed, setTyped] = useState(head ?? '');
  const { title, detail, tone } = headlineText(report.headline);
  const lastSeq = report.bids.at(-1)?.seq ?? 0;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    // The server accepts only lowercase hex, so a hash pasted in capitals is not refused for that.
    onHead(typed.trim().toLowerCase());
  };

  return (
    <article aria-label="Auditoria do lote">
      <section className={`audit-headline audit-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
        <h2>{title}</h2>
        <p>{detail}</p>
      </section>

      <ul aria-label="Resultados" className="audit-results">
        <li>{chainText(report.chain, lastSeq)}</li>
        <li>{anchorText(report.anchor)}</li>
        {report.receiptHead && <li>{receiptText(report.receiptHead)}</li>}
      </ul>

      {report.bids.length > 0 && <p className="audit-note">Um lance removido antes de ser publicado só aparece com um recibo: informe a ponta do seu para conferir.</p>}

      <form onSubmit={submit} aria-label="Conferir recibo">
        <label>
          Ponta do seu recibo
          <input value={typed} onChange={(event) => { setTyped(event.target.value); }} autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit">Conferir</button>
      </form>

      {report.bids.length > 0 && (
        <div className="audit-scroll" role="region" aria-label="Lances" tabIndex={0}>
          <table aria-label="Histórico de lances">
            <thead>
              <tr><th>Nº</th><th>Licitante</th><th>Valor</th><th>Horário</th><th>Hash</th></tr>
            </thead>
            <tbody>
              {report.bids.map((bid) => (
                <tr key={bid.seq}>
                  <td>{bid.seq}</td>
                  <td><code>{bid.bidderLabel}</code></td>
                  <td>{formatBRL(bid.amountCents)}</td>
                  <td>{SECOND.format(new Date(bid.placedAt))}</td>
                  <td><code className="audit-hash">{bid.hash}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
