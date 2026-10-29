import type { ItemSummary } from '@casa/contracts';
import { useCallback, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL } from '@/lib/format';
import { createLot } from '../api';
import { formatWhen, toInstant, toLocalField } from '../time';
import { CatalogSearch } from './CatalogSearch';
import { LotFields, lotFormError, toLotInput, type LotFormValues } from './LotForm';

const STEPS = ['Item', 'Dados', 'Publicar'] as const;
const MINUTE = 60_000;

/** The form opens ready: it starts in five minutes, runs for a week, with a round starting bid. The server still checks every value. */
function defaultValues(title: string): LotFormValues {
  const now = Date.now();
  return {
    title,
    startsAt: toLocalField(new Date(now + 5 * MINUTE).toISOString()),
    endsAt: toLocalField(new Date(now + 7 * 24 * 60 * MINUTE).toISOString()),
    startingBid: '500,00',
    increment: '50,00',
  };
}

/** What the museum says about the item, only the facts it gave. */
function factsOf(item: ItemSummary): string[] {
  return Object.values(item.attributes).filter((value): value is string => typeof value === 'string' && value !== '');
}

export function NewLotFlow({ token }: { token: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [item, setItem] = useState<ItemSummary>();
  const [values, setValues] = useState<LotFormValues>(() => defaultValues(''));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** A new step puts the focus on its heading, so a keyboard or screen reader user knows the step changed. */
  const focusHeading = useCallback((node: HTMLElement | null) => { node?.focus(); }, []);

  function pick(picked: ItemSummary) {
    setItem(picked);
    setValues(defaultValues(picked.title));
    setError(undefined);
    setStep(1);
  }

  function review(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = lotFormError(values);
    if (message) {
      setError(message);
      return;
    }
    setError(undefined);
    setStep(2);
  }

  async function publish() {
    const input = toLotInput(values);
    if (!item || !input) return;
    setBusy(true);
    setError(undefined);
    try {
      const lot = await createLot(token, { ...input, externalId: item.externalId });
      void navigate('/leiloeiro', { state: { notice: `Lote "${lot.title}" publicado.` } });
    } catch (e: unknown) {
      setError(e instanceof ApiRequestError || e instanceof Error ? e.message : 'Não foi possível publicar o lote.');
      setBusy(false);
    }
  }

  return (
    <section aria-label="Novo lote">
      <h1>Novo lote</h1>
      <ol className="flow-steps">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined}>{label}</li>
        ))}
      </ol>
      {/* Kept mounted so going back finds the same results. */}
      <div hidden={step !== 0}>
        <CatalogSearch token={token} onPick={pick} />
      </div>
      {step === 1 && item && (
        <div className="flow-step">
          <img src={item.imageUrl} alt="" className="flow-photo" />
          <div>
            <h2 tabIndex={-1} ref={focusHeading}>Sobre o item</h2>
            <p>{[item.title, ...factsOf(item)].join(' · ')}</p>
            <form onSubmit={review} aria-label="Dados do lote">
              <LotFields values={values} onChange={setValues} />
              {error && <p role="alert">{error}</p>}
              <div className="flow-actions">
                <button type="button" className="secondary" onClick={() => { setStep(0); }}>Voltar</button>
                <button type="submit">Continuar</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {step === 2 && item && (
        <div className="flow-step">
          <img src={item.imageUrl} alt="" className="flow-photo" />
          <div>
            <h2 tabIndex={-1} ref={focusHeading}>Confira e publique</h2>
            <p><strong>{values.title.trim()}</strong></p>
            <dl>
              <div><dt>Começa</dt><dd>{formatWhen(toInstant(values.startsAt))}</dd></div>
              <div><dt>Termina</dt><dd>{formatWhen(toInstant(values.endsAt))}</dd></div>
              <div><dt>Lance inicial</dt><dd>{formatBRL(toLotInput(values)?.startingBidCents ?? 0)}</dd></div>
              <div><dt>Incremento</dt><dd>{formatBRL(toLotInput(values)?.incrementCents ?? 0)}</dd></div>
            </dl>
            {error && <p role="alert">{error}</p>}
            <div className="flow-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => { setStep(1); }}>Voltar</button>
              <button type="button" disabled={busy} onClick={() => void publish()}>{busy ? 'Publicando…' : 'Publicar lote'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
