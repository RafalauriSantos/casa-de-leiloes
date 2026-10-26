import type { ItemSummary } from '@casa/contracts';
import { useState, type SyntheticEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { searchCatalog } from '../api';

interface Props {
  token: string;
  onPick: (item: ItemSummary) => void;
}

type Results = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: ItemSummary[] };

export function CatalogSearch({ token, onPick }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results>({ status: 'idle' });

  async function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setResults({ status: 'loading' });
    try {
      setResults({ status: 'ready', items: await searchCatalog(token, q.trim()) });
    } catch (e: unknown) {
      setResults({ status: 'error', message: e instanceof ApiRequestError ? e.message : 'Não foi possível buscar o item.' });
    }
  }

  return (
    <section aria-labelledby="catalog-title">
      <h2 id="catalog-title">1. Buscar item no catálogo</h2>
      <form onSubmit={(event) => void search(event)} role="search">
        <label>
          Palavra-chave
          <input value={q} onChange={(event) => { setQ(event.target.value); }} placeholder="relógio, espada, cadeira..." required minLength={2} />
        </label>
        <button type="submit" disabled={results.status === 'loading'}>Buscar</button>
      </form>
      {results.status === 'loading' && <p>Buscando no catálogo…</p>}
      {results.status === 'error' && <p role="alert">{results.message}</p>}
      {results.status === 'ready' && results.items.length === 0 && <p>Nenhum item com imagem pública para essa busca.</p>}
      {results.status === 'ready' && results.items.length > 0 && (
        <ul className="catalog-results">
          {results.items.map((item) => (
            <li key={item.externalId}>
              <img src={item.imageUrl} alt="" loading="lazy" width={80} />
              <span>{item.title}</span>
              <button type="button" onClick={() => { onPick(item); }}>Usar este item</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
