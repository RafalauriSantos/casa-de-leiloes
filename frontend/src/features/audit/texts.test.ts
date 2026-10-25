import type { AnchorResult, ChainResult, Headline, ReceiptHeadResult } from '@casa/contracts';
import { describe, expect, it } from 'vitest';
import { anchorText, chainText, headlineText, receiptText } from './texts';

// The words on the audit page. The server decides which Headline applies; these tests keep the words
// from claiming more than that headline proves.

const HEADLINES: Headline[] = [
  { kind: 'tampered' },
  { kind: 'unconfirmed' },
  { kind: 'no_bids', anchorUnverified: false },
  { kind: 'no_bids', anchorUnverified: true },
  { kind: 'intact_until', seq: 3 },
  { kind: 'intact_chain_until', seq: 3, publishedThroughSeq: 1 },
  { kind: 'no_divergence_until', publishedThroughSeq: 2 },
  { kind: 'no_divergence_until', publishedThroughSeq: 0 },
  { kind: 'anchor_unverified' },
];

const mentionsIntact = (text: string) => /[ií]ntegr/i.test(text);

describe('headlineText', () => {
  it('has a title and a detail for every headline', () => {
    for (const headline of HEADLINES) {
      const text = headlineText(headline);
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.detail.length).toBeGreaterThan(0);
    }
  });

  it('says "Adulterado" only for the tampered headline', () => {
    for (const headline of HEADLINES) {
      const said = /adulterad/i.test(headlineText(headline).title);
      expect(said).toBe(headline.kind === 'tampered');
    }
  });

  it('says "íntegro" in a title only when a receipt was found, and always bound to a seq', () => {
    for (const headline of HEADLINES) {
      const { title } = headlineText(headline);
      const found = headline.kind === 'intact_until' || headline.kind === 'intact_chain_until';
      expect(mentionsIntact(title)).toBe(found);
      if (found) expect(title).toContain(String(headline.seq));
    }
  });

  it('never says a lot is intact in the detail of a headline that proves less', () => {
    for (const headline of HEADLINES) {
      if (headline.kind === 'intact_until' || headline.kind === 'intact_chain_until') continue;
      expect(mentionsIntact(headlineText(headline).detail)).toBe(false);
    }
  });

  it('words the unconfirmed headline as a question about the receipt, never as an accusation', () => {
    const { title, detail } = headlineText({ kind: 'unconfirmed' });
    expect(title).toBe('Não confirmado');
    expect(detail).toContain('não prova adulteração');
  });

  it('says how far the proof goes, and names the case of nothing published yet', () => {
    expect(headlineText({ kind: 'no_divergence_until', publishedThroughSeq: 2 }).title).toBe('Sem divergência até o lance 2');
    expect(headlineText({ kind: 'no_divergence_until', publishedThroughSeq: 0 }).title).toBe('Nenhum lance publicado ainda');
    expect(headlineText({ kind: 'intact_chain_until', seq: 3, publishedThroughSeq: 1 }).detail).toContain('lance 1');
  });

  it('says "nenhum lance publicado ainda" instead of "lance 0" when nothing is published yet, in the headline detail and in the anchor line', () => {
    expect(headlineText({ kind: 'intact_chain_until', seq: 2, publishedThroughSeq: 0 }).detail).toContain('nenhum lance publicado ainda');
    expect(headlineText({ kind: 'intact_chain_until', seq: 2, publishedThroughSeq: 0 }).detail).not.toContain('lance 0');
    expect(anchorText({ status: 'pending', publishedThroughSeq: 0, stale: false })).toBe('Nenhum lance publicado ainda; os seguintes aguardam publicação');
    expect(anchorText({ status: 'pending', publishedThroughSeq: 0, stale: true })).toBe('Nenhum lance publicado ainda; os seguintes aguardam publicação há 10 minutos ou mais');
    expect(anchorText({ status: 'published', publishedThroughSeq: 0 })).toBe('Sem lances para publicar');
  });

  it('tells that a removal of the last bid is only covered by a receipt when no receipt was sent', () => {
    expect(headlineText({ kind: 'no_divergence_until', publishedThroughSeq: 2 }).detail).toContain('recibo');
  });

  it('says the anchor was not verified for a lot with no bids only when that is true', () => {
    expect(headlineText({ kind: 'no_bids', anchorUnverified: false }).detail).not.toContain('âncora');
    expect(headlineText({ kind: 'no_bids', anchorUnverified: true }).detail).toContain('âncora não foi verificada');
  });

  it('gives each headline a tone for the page, danger only for tampered', () => {
    for (const headline of HEADLINES) expect(headlineText(headline).tone === 'danger').toBe(headline.kind === 'tampered');
  });
});

describe('chainText, anchorText and receiptText', () => {
  it('says where the chain breaks, and never "íntegra" for the whole chain', () => {
    expect(chainText({ status: 'tampered', brokenAtSeq: 2 }, 3)).toBe('Cadeia quebrada no lance 2');
    expect(chainText({ status: 'intact' }, 3)).toBe('Cadeia sem quebra até o lance 3');
    expect(chainText({ status: 'intact' }, 0)).toBe('Sem lances na cadeia');
    for (const chain of [{ status: 'intact' }, { status: 'tampered', brokenAtSeq: 1 }] as ChainResult[]) expect(mentionsIntact(chainText(chain, 3))).toBe(false);
  });

  it('describes every anchor result', () => {
    const cases: [AnchorResult, string][] = [
      [{ status: 'published', publishedThroughSeq: 3 }, 'Âncora publicada até o lance 3'],
      [{ status: 'pending', publishedThroughSeq: 1, stale: false }, 'Âncora publicada até o lance 1; os seguintes aguardam publicação'],
      [{ status: 'pending', publishedThroughSeq: 1, stale: true }, 'Âncora publicada até o lance 1; os seguintes aguardam publicação há 10 minutos ou mais'],
      [{ status: 'divergent', atSeq: 2 }, 'A âncora diverge do histórico a partir do lance 2'],
      [{ status: 'divergent', atSeq: null }, 'O arquivo da âncora está malformado'],
      [{ status: 'unavailable' }, 'Não foi possível ler a âncora agora'],
      [{ status: 'off' }, 'A âncora não está configurada neste ambiente'],
    ];
    for (const [anchor, text] of cases) expect(anchorText(anchor)).toBe(text);
  });

  it('describes the receipt result, and says only "not found" when it is not in the history', () => {
    const found: ReceiptHeadResult = { status: 'in_history', seq: 2 };
    const missing: ReceiptHeadResult = { status: 'not_in_history' };
    expect(receiptText(found)).toBe('Sua ponta é a do lance 2');
    expect(receiptText(missing)).toBe('Ponta não encontrada neste histórico');
    expect(/remov|alterad|adulterad/i.test(receiptText(missing))).toBe(false);
  });
});
