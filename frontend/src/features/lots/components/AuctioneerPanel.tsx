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
      <CatalogSearch token={token} onPick={(picked) => { setItem(picked); setNotice(undefined); }} />
      {item && (
        <section aria-labelledby="new-lot-title">
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
      <OwnLots key={version} token={token} />
    </section>
  );
}
