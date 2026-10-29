import { CATALOG_SEARCH_WINDOW, type CatalogPage, type ItemSummary } from '@casa/contracts';
import { useEffect, useState, type SyntheticEvent } from 'react';
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

function itemMeta(item: ItemSummary): string {
  const parts = [
    item.attributes.date,
    item.attributes.medium,
    item.attributes.department ?? item.attributes.artist ?? item.attributes.culture,
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  return parts.join(' • ');
}

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

  // Before anything is typed, the screen shows the featured items of the catalog (B44).
  useEffect(() => {
    void load('', 1);
  }, []);

  function search(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    run(q.trim());
  }

  return (
    <section aria-label="Buscar item" className="catalog-section">
      <form onSubmit={search} role="search" className="catalog-search-form">
        <label className="catalog-search-label">
          <span className="catalog-search-caption">Buscar item no acervo</span>
          <span className="catalog-input-wrap">
            <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input value={q} onChange={(event) => { setQ(event.target.value); }} placeholder="Buscar item no acervo (relógio, espada, cadeira...)" required minLength={2} />
          </span>
        </label>
        <button type="submit" className="catalog-search-submit" disabled={results.status === 'loading'}>Buscar</button>
      </form>
      <div className="shortcuts">
        <button
          type="button"
          className="chip"
          data-active={searched === '' ? '' : undefined}
          disabled={results.status === 'loading'}
          onClick={() => { setQ(''); run(''); }}
        >
          Todos
        </button>
        {SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.term}
            type="button"
            className="chip"
            data-active={searched === shortcut.term ? '' : undefined}
            disabled={results.status === 'loading'}
            onClick={() => { setQ(shortcut.term); run(shortcut.term); }}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      {results.status === 'loading' && <p>Buscando no acervo…</p>}
      {results.status === 'error' && <p role="alert">{results.message}</p>}
      {results.status === 'ready' && results.page.total === 0 && <p>Nenhum item com imagem pública para essa busca.</p>}
      {results.status === 'ready' && results.page.total > 0 && (
        <>
          {searched === '' ? (
            <h3 className="catalog-heading">Destaques do acervo</h3>
          ) : (
            <p className="catalog-count">
              {results.page.total.toLocaleString('pt-BR')} resultados · Página {results.page.page} de {results.page.pages}
              {results.page.total > CATALOG_SEARCH_WINDOW && ' · o acervo deixa ver só os primeiros 10.000 resultados de cada busca'}
            </p>
          )}
          <ul className="catalog-results">
            {results.page.items.map((item) => {
              const meta = itemMeta(item);
              return (
                <li key={item.externalId} className="catalog-card">
                  <div className="catalog-thumb-wrap">
                    <img src={item.imageUrl} alt="" loading="lazy" className="lot-thumb catalog-thumb" />
                  </div>
                  <div className="catalog-card-body">
                    <strong className="catalog-card-title">{item.title}</strong>
                    {meta && <span className="catalog-card-meta">{meta}</span>}
                    <button type="button" className="catalog-pick-btn" aria-label="Usar este item" onClick={() => { onPick(item); }}>
                      <span>Usar</span>
                      <span aria-hidden="true"> →</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <nav aria-label="Páginas do catálogo" className="catalog-pagination">
            <button type="button" className="secondary pagination-btn" disabled={results.page.page <= 1} onClick={() => { void load(searched, results.page.page - 1); }}>
              <span aria-hidden="true">← </span>Página anterior
            </button>
            <span className="pagination-info" aria-hidden={searched !== '' ? 'true' : undefined}>
              {searched === '' ? `Página ${results.page.page} de ${results.page.pages}` : `${results.page.page} / ${results.page.pages}`}
            </span>
            <button type="button" className="secondary pagination-btn" disabled={!results.page.hasNext} onClick={() => { void load(searched, results.page.page + 1); }}>
              Próxima página<span aria-hidden="true"> →</span>
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
