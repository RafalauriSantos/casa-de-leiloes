import { MAX_INCREMENT_CENTS, MAX_STARTING_BID_CENTS, type LotInput, type OwnLot } from '@casa/contracts';
import { useState, type SyntheticEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { formatBRL, formatDynamicReais, formatReaisInput, parseReaisToCents } from '@/lib/format';
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

/** Returns the validation message when a field is not valid or exceeds the ceiling, or undefined when acceptable. */
export function lotFormError(values: LotFormValues): string | undefined {
  const title = values.title.trim();
  if (title.length < 3) return 'O título precisa ter pelo menos 3 caracteres.';
  if (title.length > 120) return 'O título pode ter até 120 caracteres.';
  const startingBidCents = parseReaisToCents(values.startingBid);
  const incrementCents = parseReaisToCents(values.increment);
  if (
    values.startsAt === '' ||
    values.endsAt === '' ||
    Number.isNaN(Date.parse(toInstant(values.startsAt))) ||
    Number.isNaN(Date.parse(toInstant(values.endsAt))) ||
    startingBidCents === undefined ||
    incrementCents === undefined
  ) {
    return 'Confira o valor (por exemplo 500,00) e as datas.';
  }
  if (startingBidCents > MAX_STARTING_BID_CENTS) {
    return `O lance inicial pode ser de até ${formatBRL(MAX_STARTING_BID_CENTS)}.`;
  }
  if (incrementCents > MAX_INCREMENT_CENTS) {
    return `O incremento mínimo pode ser de até ${formatBRL(MAX_INCREMENT_CENTS)}.`;
  }
  return undefined;
}

/** The form's values as the API receives them; `undefined` when a field is not a valid amount or time. */
export function toLotInput(values: LotFormValues): LotInput | undefined {
  if (lotFormError(values) !== undefined) return undefined;
  const startingBidCents = parseReaisToCents(values.startingBid);
  const incrementCents = parseReaisToCents(values.increment);
  if (startingBidCents === undefined || incrementCents === undefined) return undefined;
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
    startingBid: formatReaisInput(lot.startingBidCents),
    increment: formatReaisInput(lot.incrementCents),
  };
}

const DURATION_PRESETS = [
  { label: '+24 horas', hours: 24 },
  { label: '+3 dias', hours: 72 },
  { label: '+7 dias', hours: 168 },
] as const;

/** The five fields of a lot, shared by the edit form and the step 2 of the new lot flow. */
export function LotFields({ values, onChange }: { values: LotFormValues; onChange: (values: LotFormValues) => void }) {
  const set = (field: keyof LotFormValues) => (event: { target: { value: string } }) => {
    onChange({ ...values, [field]: event.target.value });
  };

  const setCurrency = (field: 'startingBid' | 'increment') => (event: { target: { value: string } }) => {
    onChange({ ...values, [field]: formatDynamicReais(event.target.value) });
  };

  const blurCurrency = (field: 'startingBid' | 'increment') => () => {
    const cents = parseReaisToCents(values[field]);
    if (cents !== undefined) {
      onChange({ ...values, [field]: formatReaisInput(cents) });
    }
  };

  const applyDuration = (hours: number) => {
    const parsedStart = Date.parse(toInstant(values.startsAt));
    const baseMs = Number.isNaN(parsedStart) ? Date.now() + 5 * 60_000 : parsedStart;
    const nextEnd = toLocalField(new Date(baseMs + hours * 3_600_000).toISOString());
    onChange({ ...values, endsAt: nextEnd });
  };

  return (
    <>
      <label className="lot-field-full">
        Título
        <input value={values.title} onChange={set('title')} required minLength={3} maxLength={120} />
      </label>
      <div className="lot-field-grid">
        <label>
          Início (horário de Brasília)
          <input type="datetime-local" value={values.startsAt} onChange={set('startsAt')} required />
        </label>
        <label>
          Fim (horário de Brasília)
          <input type="datetime-local" value={values.endsAt} onChange={set('endsAt')} required />
        </label>
      </div>
      <div className="duration-presets" role="group" aria-label="Atalhos de duração">
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset.hours}
            type="button"
            className="chip duration-chip"
            onClick={() => { applyDuration(preset.hours); }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="lot-field-grid">
        <div className="lot-field-col">
          <label>
            Lance inicial (R$)
            <span className="currency-field">
              <input
                value={values.startingBid}
                onChange={setCurrency('startingBid')}
                onBlur={blurCurrency('startingBid')}
                inputMode="numeric"
                required
                placeholder="500,00"
              />
            </span>
          </label>
          <small className="field-limit">Máximo: {formatBRL(MAX_STARTING_BID_CENTS)}</small>
        </div>
        <div className="lot-field-col">
          <label>
            Incremento mínimo (R$)
            <span className="currency-field">
              <input
                value={values.increment}
                onChange={setCurrency('increment')}
                onBlur={blurCurrency('increment')}
                inputMode="numeric"
                required
                placeholder="50,00"
              />
            </span>
          </label>
          <small className="field-limit">Máximo: {formatBRL(MAX_INCREMENT_CENTS)}</small>
        </div>
      </div>
    </>
  );
}

export function LotForm({ initial, submitLabel, onSubmit, onDone }: Props) {
  const [values, setValues] = useState<LotFormValues>(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = lotFormError(values);
    const input = toLotInput(values);
    if (message || !input) {
      setError(message ?? 'Confira o valor (por exemplo 500,00) e as datas.');
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
