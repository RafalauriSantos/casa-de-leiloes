import type { ItemSummary, OwnLot } from '@casa/contracts';
import { useState } from 'react';
import { createLot } from '../api';
import { CatalogSearch } from './CatalogSearch';
import { LotForm, type LotFormValues } from './LotForm';
import { OwnLots } from './OwnLots';

export function AuctioneerPanel({ token }: { token: string }) {
  const [item, setItem] = useState<ItemSummary>();
  const [notice, setNotice] = useState<string>();
  const [version, setVersion] = useState(0);

  const initial: LotFormValues = {
    title: item?.title ?? '',
    startsAt: '',
    endsAt: '',
    startingBid: '',
    increment: '',
  };

  return (
    <section aria-label="Painel do leiloeiro">
      <h1>Painel do leiloeiro</h1>
      <nav aria-label="Etapas do painel" className="steps">
        <a href="#buscar-item"><b>1</b>Buscar item</a>
        <a href="#novo-lote"><b>2</b>Configurar o lote</a>
        <a href="#meus-lotes"><b>3</b>Meus lotes</a>
      </nav>
      <div id="buscar-item">
        <CatalogSearch token={token} onPick={(picked) => { setItem(picked); setNotice(undefined); }} />
      </div>
      {item && (
        <section aria-labelledby="new-lot-title" id="novo-lote">
          <h2 id="new-lot-title">2. Novo lote a partir de "{item.title}"</h2>
          <img src={item.imageUrl} alt={item.title} width={160} />
          <LotForm
            key={item.externalId}
            initial={initial}
            submitLabel="Publicar lote"
            onSubmit={(input) => createLot(token, { ...input, externalId: item.externalId })}
            onDone={(lot: OwnLot) => {
              setItem(undefined);
              setNotice(`Lote "${lot.title}" publicado.`);
              setVersion((n) => n + 1);
            }}
          />
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      <div id="meus-lotes">
        <OwnLots key={version} token={token} />
      </div>
    </section>
  );
}
