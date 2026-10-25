import type { AnchorResult, ChainResult, Headline, ReceiptHeadResult } from '@casa/contracts';

// The words of the audit page. The server decides which Headline applies (D22); these words say no more than
// that headline proves. A lot-wide "íntegro" does not exist: the anchor cannot catch the removal of a last bid
// before its publication, and a receipt proves only the bids up to its own seq.

export type Tone = 'danger' | 'warning' | 'neutral' | 'ok';

export interface HeadlineText {
  title: string;
  detail: string;
  tone: Tone;
}

export function headlineText(headline: Headline): HeadlineText {
  switch (headline.kind) {
    case 'tampered':
      return {
        title: 'Adulterado',
        detail: 'O histórico deste lote não confere com a prova que guardamos. Veja abaixo onde começa a divergência.',
        tone: 'danger',
      };
    case 'unconfirmed':
      return {
        title: 'Não confirmado',
        detail: 'A ponta informada não foi encontrada neste histórico. Isso não prova adulteração: confira se copiou a ponta do recibo certo, deste lote.',
        tone: 'warning',
      };
    case 'no_bids':
      return {
        title: 'Sem lances',
        detail: headline.anchorUnverified ? 'Ainda não há o que auditar. A âncora não foi verificada.' : 'Ainda não há o que auditar.',
        tone: 'neutral',
      };
    case 'intact_until':
      return {
        title: `Íntegro até o lance ${String(headline.seq)}`,
        detail: `A cadeia não tem quebra, a âncora pública confere e o seu recibo foi encontrado. Este recibo não cobre os lances depois do ${String(headline.seq)}.`,
        tone: 'ok',
      };
    case 'intact_chain_until':
      return {
        title: `Íntegro na cadeia até o lance ${String(headline.seq)}`,
        detail:
          headline.publishedThroughSeq === 0
            ? 'O seu recibo foi encontrado e a cadeia não tem quebra, mas nenhum lance publicado ainda na âncora pública.'
            : `O seu recibo foi encontrado e a cadeia não tem quebra, mas a âncora pública só tem os lances até o lance ${String(headline.publishedThroughSeq)}.`,
        tone: 'ok',
      };
    case 'no_divergence_until':
      return {
        title: headline.publishedThroughSeq === 0 ? 'Nenhum lance publicado ainda' : `Sem divergência até o lance ${String(headline.publishedThroughSeq)}`,
        detail:
          'Nada contradiz o histórico até onde a âncora pública chega. A remoção do último lance antes de ele ser publicado só é detectada com um recibo: informe a ponta do seu recibo para conferir.',
        tone: 'neutral',
      };
    case 'anchor_unverified':
      return {
        title: 'Âncora não verificada',
        detail: 'Não foi possível ler a prova pública (ou ela não está configurada), então o lote não é confirmado. O resultado da cadeia e o do recibo aparecem abaixo, cada um por si.',
        tone: 'warning',
      };
  }
}

export function chainText(chain: ChainResult, lastSeq: number): string {
  if (chain.status === 'tampered') return `Cadeia quebrada no lance ${String(chain.brokenAtSeq)}`;
  return lastSeq === 0 ? 'Sem lances na cadeia' : `Cadeia sem quebra até o lance ${String(lastSeq)}`;
}

export function anchorText(anchor: AnchorResult): string {
  switch (anchor.status) {
    case 'published':
      return anchor.publishedThroughSeq === 0 ? 'Sem lances para publicar' : `Âncora publicada até o lance ${String(anchor.publishedThroughSeq)}`;
    case 'pending': {
      const through = anchor.publishedThroughSeq === 0 ? 'Nenhum lance publicado ainda' : `Âncora publicada até o lance ${String(anchor.publishedThroughSeq)}`;
      return `${through}; os seguintes aguardam publicação${anchor.stale ? ' há 10 minutos ou mais' : ''}`;
    }
    case 'divergent':
      return anchor.atSeq === null ? 'O arquivo da âncora está malformado' : `A âncora diverge do histórico a partir do lance ${String(anchor.atSeq)}`;
    case 'unavailable':
      return 'Não foi possível ler a âncora agora';
    case 'off':
      return 'A âncora não está configurada neste ambiente';
  }
}

export function receiptText(receipt: ReceiptHeadResult): string {
  return receipt.status === 'in_history' ? `Sua ponta é a do lance ${String(receipt.seq)}` : 'Ponta não encontrada neste histórico';
}
