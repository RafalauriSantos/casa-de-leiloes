import { MAX_INCREMENT_CENTS, MAX_STARTING_BID_CENTS, type LotInput, type OwnLot } from '@casa/contracts';
import { useState, type SyntheticEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL, parseReaisToCents } from '@/lib/format';
import { toInstant, toLocalField } from '../time';

export interface LotFormValues {
  title: string;
  startsAt: string;
  endsAt: string;
  startingBid: string;
  increment: string;
}

interface Props {
  /** Pre-filled values: the item's title when creating, the lot's current values when editing. */
  initial: LotFormValues;
  submitLabel: string;
  onSubmit: (input: LotInput) => Promise<OwnLot>;
  onDone: (lot: OwnLot) => void;
}

/** The form's values as the API receives them; `undefined` when a field is not a valid amount or time. */
export function toLotInput(values: LotFormValues): LotInput | undefined {
  const startingBidCents = parseReaisToCents(values.startingBid);
  const incrementCents = parseReaisToCents(values.increment);
  if (values.startsAt === '' || values.endsAt === '' || startingBidCents === undefined || incrementCents === undefined) return undefined;
  return {
    title: values.title.trim(),
    startsAt: toInstant(values.startsAt),
    endsAt: toInstant(values.endsAt),
    startingBidCents,
    incrementCents,
  };
}

export function valuesOf(lot: OwnLot): LotFormValues {
  return {
    title: lot.title,
    startsAt: toLocalField(lot.startsAt),
    endsAt: toLocalField(lot.endsAt),
    startingBid: String(lot.startingBidCents / 100).replace('.', ','),
    increment: String(lot.incrementCents / 100).replace('.', ','),
  };
}

/** The five fields of a lot, shared by the edit form and the step 2 of the new lot flow. */
export function LotFields({ values, onChange }: { values: LotFormValues; onChange: (values: LotFormValues) => void }) {
  const set = (field: keyof LotFormValues) => (event: { target: { value: string } }) => {
    onChange({ ...values, [field]: event.target.value });
  };
  return (
    <>
      <label>
        Título
        <input value={values.title} onChange={set('title')} required minLength={3} maxLength={120} />
      </label>
      <label>
        Início (horário de Brasília)
        <input type="datetime-local" value={values.startsAt} onChange={set('startsAt')} required />
      </label>
      <label>
        Fim (horário de Brasília)
        <input type="datetime-local" value={values.endsAt} onChange={set('endsAt')} required />
      </label>
      <label>
        Lance inicial (R$)
        <input value={values.startingBid} onChange={set('startingBid')} inputMode="decimal" required placeholder="500,00" />
      </label>
      <label>
        Incremento mínimo (R$)
        <input value={values.increment} onChange={set('increment')} inputMode="decimal" required placeholder="50,00" />
      </label>
      <small>
        Limites: lance inicial até {formatBRL(MAX_STARTING_BID_CENTS)}, incremento até {formatBRL(MAX_INCREMENT_CENTS)}.
      </small>
    </>
  );
}

export function LotForm({ initial, submitLabel, onSubmit, onDone }: Props) {
  const [values, setValues] = useState<LotFormValues>(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = toLotInput(values);
    if (!input) {
      setError('Confira o valor (por exemplo 500,00) e as datas.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onDone(await onSubmit(input));
    } catch (e: unknown) {
      setError(e instanceof ApiRequestError || e instanceof Error ? e.message : 'Não foi possível salvar o lote.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label={submitLabel}>
      <LotFields values={values} onChange={setValues} />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Salvando…' : submitLabel}</button>
    </form>
  );
}
