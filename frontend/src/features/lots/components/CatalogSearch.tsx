import { CATALOG_SEARCH_WINDOW, type CatalogPage, type ItemSummary } from '@casa/contracts';
import { useState, type SyntheticEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { searchCatalog } from '../api';

interface Props {
  token: string;
  onPick: (item: ItemSummary) => void;
}

type Results = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; page: CatalogPage };

/** One tap lists items: the catalog is never an empty box. The label is Portuguese, the term is what the Met understands. */
const SHORTCUTS: Array<{ label: string; term: string }> = [
  { label: 'Relógio', term: 'clock' },
  { label: 'Mapa', term: 'map' },
  { label: 'Vaso', term: 'vase' },
  { label: 'Pintura', term: 'painting' },
  { label: 'Espada', term: 'sword' },
];

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

  function run(term: string) {
    setSearched(term);
    void load(term, 1);
  }

  function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    run(q.trim());
  }

  return (
    <section aria-label="Buscar item">
      <form onSubmit={search} role="search">
        <label>
          Buscar item no acervo
          <input value={q} onChange={(event) => { setQ(event.target.value); }} placeholder="relógio, espada, cadeira..." required minLength={2} />
        </label>
        <button type="submit" disabled={results.status === 'loading'}>Buscar</button>
      </form>
      <div className="shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <button key={shortcut.term} type="button" className="chip" disabled={results.status === 'loading'} onClick={() => { setQ(shortcut.term); run(shortcut.term); }}>
            {shortcut.label}
          </button>
        ))}
      </div>
      {results.status === 'loading' && <p>Buscando no acervo…</p>}
      {results.status === 'error' && <p role="alert">{results.message}</p>}
      {results.status === 'ready' && results.page.total === 0 && <p>Nenhum item com imagem pública para essa busca.</p>}
      {results.status === 'ready' && results.page.total > 0 && (
        <>
          <p className="catalog-count">
            {results.page.total.toLocaleString('pt-BR')} resultados · Página {results.page.page} de {results.page.pages}
            {results.page.total > CATALOG_SEARCH_WINDOW && ' · o acervo deixa ver só os primeiros 10.000 resultados de cada busca'}
          </p>
          <ul className="catalog-results">
            {results.page.items.map((item) => (
              <li key={item.externalId}>
                <img src={item.imageUrl} alt="" loading="lazy" className="lot-thumb" />
                <span>{item.title}</span>
                <button type="button" aria-label="Usar este item" onClick={() => { onPick(item); }}>Usar</button>
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
