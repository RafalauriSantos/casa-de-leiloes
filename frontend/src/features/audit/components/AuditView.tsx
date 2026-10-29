import type { AuditReport } from '@casa/contracts';
import { formatBRL } from '@/lib/format';
import { anchorText, chainText, headlineText, receiptText } from '../texts';
import { ReceiptForm } from './ReceiptForm';

const SECOND = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' });

/** The audit of a lot, from the server's answer: the headline, the three results, the receipt form and every bid. */
export function AuditView({ report, head, onHead }: { report: AuditReport; head: string | undefined; onHead: (head: string) => void }) {
  const { title, detail, tone } = headlineText(report.headline);
  const lastSeq = report.bids.at(-1)?.seq ?? 0;

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

      <ReceiptForm head={head} onHead={onHead} />

      {report.bids.length > 0 && (
        <div className="audit-scroll" role="region" aria-label="Lances" tabIndex={0}>
          <table aria-label="Histórico de lances">
            <thead>
              <tr><th>Nº</th><th>Licitante</th><th>Valor</th><th>Horário</th><th>Hash</th></tr>
            </thead>
            <tbody>
              {report.bids.map((bid) => {
                const broken = report.chain.status === 'tampered' && report.chain.brokenAtSeq === bid.seq;
                return (
                <tr key={bid.seq} className={broken ? 'audit-row-broken' : undefined}>
                  <td>{bid.seq}{broken && <strong className="audit-break"> quebra aqui</strong>}</td>
                  <td><code>{bid.bidderLabel}</code></td>
                  <td>{formatBRL(bid.amountCents)}</td>
                  <td>{SECOND.format(new Date(bid.placedAt))}</td>
                  <td><code className="audit-hash">{bid.hash}</code></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
