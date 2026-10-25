// The owner's release of a lot whose history fails verification (D20). Not an endpoint: it runs on the owner's machine,
// with the privileged database connection. It shows what the system sees, refuses when a release cannot be made or the
// secret looks wrong, asks for the leader and the amount the owner confirms, and writes only after CONFIRMAR.
//
//   Keep the secrets in an env file or a secret manager, never on the command line (shell history).
//   npx tsx backend/scripts/release-lot.ts <lot-id> "<quem decidiu>" "<motivo>"
import { createInterface } from 'node:readline';
import { loadConfig } from '../src/config';
import { createDb } from '../src/shared/db';
import { isConfirmation, parseAmountAnswer, parseLeaderAnswer, releaseTamperedLot, reviewTamperedLot } from '../src/modules/settlement';

const [lotId, decidedBy = '', reason = ''] = process.argv.slice(2);
if (!lotId || decidedBy.trim() === '' || reason.trim() === '') {
  console.error('uso: release-lot.ts <id-do-lote> "<quem decidiu>" "<motivo>"');
  process.exit(2);
}

// The answers come from standard input, one per line, read in order: it works the same at a terminal and from a pipe.
const answers = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  const next = await answers.next();
  return next.done ? '' : next.value;
}

let config: ReturnType<typeof loadConfig>;
let db: ReturnType<typeof createDb> | undefined;
try {
  config = loadConfig(process.env);
  db = createDb(config.databaseUrl);
  const review = await reviewTamperedLot(db, config, lotId);
  if (!review) throw new Error('lote não encontrado.');

  console.log(`lote ${review.lotId} (${review.status}), ponta ${String(review.headSeq)}`);
  console.log(`  cópia do lote:   líder ${review.copy.leaderId ?? '-'}, valor ${review.copy.amountCents === null ? 'vazio' : `${String(review.copy.amountCents)} centavos`}`);
  console.log(review.last === null ? '  último lance:    nenhum' : `  último lance:    líder ${review.last.leaderId}, valor ${String(review.last.amountCents)} centavos (lance ${String(review.last.seq)})`);
  console.log(review.brokenAtSeq === null ? '  cadeia: sem quebra' : `  cadeia: quebra no lance ${String(review.brokenAtSeq)}`);
  console.log(`  cópia ${review.copyDisagrees ? 'não confere' : 'confere'} com o último lance`);
  if (!review.decidable) throw new Error(review.reason);

  if (review.reference === 'none') {
    console.log('  não há liquidação de referência para conferir o segredo: confirme que AUDIT_HMAC_SECRET é o de produção.');
    if ((await ask('Digite SEGREDO para continuar: ')).trim() !== 'SEGREDO') throw new Error('nada foi gravado.');
  }
  const leaderId = parseLeaderAnswer(await ask('Líder a liberar (uuid, ou vazio se não houver líder): '));
  const amountCents = parseAmountAnswer(await ask('Valor a liberar, em centavos (só dígitos): '));
  if (amountCents === null) throw new Error('o valor deve ser um número inteiro de centavos; nada foi gravado.');
  if (!isConfirmation(await ask('Digite CONFIRMAR para gravar a decisão: '))) throw new Error('nada foi gravado.');

  const result = await releaseTamperedLot(db, config, lotId, { decidedBy, reason, leaderId, amountCents });
  console.log(`liberado: ${String(result.releasedCents)} centavos do líder ${result.leaderId ?? '(ninguém)'} voltam ao saldo disponível; o lote fica cancelado pela liberação (primeiro lance quebrado: ${String(result.brokenAtSeq)}).`);
} catch (error) {
  console.error(`não liberado: ${error instanceof Error ? error.message : 'erro inesperado'}`);
  process.exitCode = 1;
} finally {
  void answers.return?.();
  await db?.end();
}
