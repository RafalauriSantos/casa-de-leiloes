import type { CatalogPage, ItemSummary } from '@casa/contracts';
import { useState, type SyntheticEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { searchCatalog } from '../api';

interface Props {
  token: string;
  onPick: (item: ItemSummary) => void;
}

type Results = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; page: CatalogPage };

export function CatalogSearch({ token, onPick }: Props) {
  const [q, setQ] = useState('');
  // The paging uses the term that was searched, not what is typed now.
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<Results>({ status: 'idle' });

  async function load(term: string, page: number) {
    setResults({ status: 'loading' });
    try {
      setResults({ status: 'ready', page: await searchCatalog(token, term, page) });
    } catch (e: unknown) {
      setResults({ status: 'error', message: e instanceof ApiRequestError ? e.message : 'Não foi possível buscar o item.' });
    }
  }

  function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = q.trim();
    setSearched(term);
    void load(term, 1);
  }

  return (
    <section aria-labelledby="catalog-title">
      <h2 id="catalog-title">1. Buscar item no catálogo</h2>
      <form onSubmit={search} role="search">
        <label>
          Palavra-chave
          <input value={q} onChange={(event) => { setQ(event.target.value); }} placeholder="relógio, espada, cadeira..." required minLength={2} />
        </label>
        <button type="submit" disabled={results.status === 'loading'}>Buscar</button>
      </form>
      {results.status === 'loading' && <p>Buscando no catálogo…</p>}
      {results.status === 'error' && <p role="alert">{results.message}</p>}
      {results.status === 'ready' && results.page.total === 0 && <p>Nenhum item com imagem pública para essa busca.</p>}
      {results.status === 'ready' && results.page.total > 0 && (
        <>
          <p>
            {results.page.total.toLocaleString('pt-BR')} resultados · Página {results.page.page} de {results.page.pages}
          </p>
          <ul className="catalog-results">
            {results.page.items.map((item) => (
              <li key={item.externalId}>
                <img src={item.imageUrl} alt="" loading="lazy" width={80} />
                <span>{item.title}</span>
                <button type="button" onClick={() => { onPick(item); }}>Usar este item</button>
              </li>
            ))}
          </ul>
          <nav aria-label="Páginas do catálogo">
            <button type="button" disabled={results.page.page <= 1} onClick={() => { void load(searched, results.page.page - 1); }}>
              Página anterior
            </button>
            <button type="button" disabled={!results.page.hasNext} onClick={() => { void load(searched, results.page.page + 1); }}>
              Próxima página
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
