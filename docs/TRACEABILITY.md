# Rastreabilidade: Critérios do Enunciado aos Testes

Cada critério das jornadas descritas no enunciado técnico mapeia diretamente para os testes automatizados que comprovam sua conformidade. Qualquer critério sem teste automatizado direto é explicitamente indicado como pendente ou verificado por checagem manual.

## J0: Acesso e Perfis

| Critério | Testes | Situação |
|---|---|---|
| 0.1 Cadastro de licitante | `frontend/src/features/auth/auth.test.tsx` ("creates a real account and opens a session"); `backend/tests/integration/me.test.ts` ("creates the profile and an empty wallet on sign-up") | Coberto |
| 0.2 Login com erro genérico e seguro | `auth.test.tsx` ("shows one generic message for a wrong login"); `frontend/src/features/auth/api.test.ts` ("gives one generic refusal for any sign-up error") | Coberto |
| 0.3 Logout seguro | `frontend/src/journey.test.tsx` ("signs up, sees an empty wallet, deposits once even on a double click, signs out and back in") | Coberto |
| 0.4 Bloqueio de perfil em tela e API (401/403) | Casos 401/403 em `catalog.test.ts`, `lots.test.ts`, `wallet.test.ts`, `bidding.test.ts`; `backend/tests/integration/access-matrix.test.ts` (matriz de acesso completa por papel); `frontend/src/features/lots/lots.test.tsx`; `journey.test.tsx` | Coberto |
| 0.5 Identidade obtida estritamente do token JWT | `me.test.ts` ("returns the identity taken from the token"); `auth-claims.test.ts` | Coberto |
| 0.6 Cadastro pergunta "Quero comprar" ou "Quero vender" atribuindo o papel correto (B14) | `me.test.ts` ("gives the role chosen at sign-up ..."); `journey.test.tsx` ("signs up choosing \"Quero vender\" and gets the auctioneer panel, not a wallet") | Coberto |
| 0.7 Apenas esses dois papéis são aceitos e o papel é imutável após cadastro (B14) | `me.test.ts` ("accepts no other role at sign-up, and the role cannot change after it") | Coberto |
| 0.8 Tela de login disponibiliza atalhos de contas de demonstração (B15) | `auth.test.tsx` ("offers the demo accounts, and a shortcut is a real sign-in") | Coberto |

## J1: Painel do Leiloeiro

| Critério | Testes | Situação |
|---|---|---|
| 1.1 Busca de itens no acervo externo (The Met) com paginação até 10.000 resultados | `backend/tests/integration/catalog.test.ts` ("pages through every result", "answers an empty page", "refuses a page that is not a positive whole number"); `frontend/src/features/lots/catalog-states.test.tsx`; `lots.test.tsx` | Coberto |
| 1.2 Criação de lote com validações de tempo e valores | `backend/tests/integration/lots.test.ts` (criação, recusas e mensagens em português para valores fora dos limites); `backend/src/modules/lots/rules.test.ts`; `lots.test.tsx` | Coberto |
| 1.3 Cópia e persistência dos dados do acervo no banco local | `lots.test.ts` ("keeps the copy: the lot keeps its item even if the catalog later fails") | Coberto |
| 1.4 Busca com a API externa fora do ar exibe mensagem clara | `catalog.test.ts` (casos de 503 `catalog_unavailable`); `frontend/src/features/lots/catalog-states.test.tsx` | Coberto |
| 1.5 Edição permitida apenas antes do início do lote e sem lances | `lots.test.ts` (casos de edição, 409 `lot_not_editable`); `rules.test.ts`; `lots.test.tsx` | Coberto |
| 1.6 Cancelamento de lote não encerrado com estorno automático do líder (9.1) | `lots.test.ts` (casos de cancelamento); `rules.test.ts`; `cancel-refund.test.ts` | Coberto |
| 1.7 Resultado de cada lote encerrado e total recebido consolidado | `backend/tests/integration/auctioneer-results.test.ts` (valor vendido, sem lances, pendente de liquidação, total exclusivo do leiloeiro, 403 para licitante); `frontend/src/features/lots/results.test.tsx` | Coberto |
| 1.8 Isolamento de lotes: leiloeiro gerencia apenas seus próprios lotes | `lots.test.ts` ("lists only the auctioneer's ...", "refuses to edit another auctioneer's ...", "refuses to cancel another auctioneer's ...") | Coberto |
| 1.9 Leiloeiro não pode dar lances em lotes | `bidding.test.ts` ("refuses an anonymous visitor with 401 and an auctioneer with 403"); `frontend/src/features/lots/bidding.test.tsx` | Coberto |

## J2: Vitrine Pública e Catálogo

| Critério | Testes | Situação |
|---|---|---|
| 2.1 Abas Ao vivo, Agendados e Encerrados; lotes cancelados ocultos | `lots.test.ts` ("lists lots by state and hides cancelled ones"); `frontend/src/features/lots/showcase.test.tsx`; `LotCard.test.tsx` | Coberto |
| 2.2 Card com imagem, título, lance atual e contagem de tempo | `frontend/src/features/lots/showcase.test.tsx`; `frontend/src/features/lots/components/LotCard.test.tsx`; `lots.test.tsx` | Coberto |
| 2.3 Busca por título e filtragem por estado | `lots.test.ts` ("searches by title, ignoring case ...", "refuses an unknown status filter with 422") | Coberto |
| 2.4 Vitrine continua funcionando mesmo se a API externa do Met estiver fora do ar | `catalog.test.ts` ("keeps working for everything else when the catalog is down") | Coberto |
| 2.5 Estados de carregamento, vazio e erro com nova tentativa sem piscar dados anteriores | `lots.test.tsx`; `catalog-states.test.tsx`; `showcase.test.tsx` | Coberto |

## J3: Carteira do Licitante

| Critério | Testes | Situação |
|---|---|---|
| 3.1 Total, comprometido, disponível e depósito simulado | `frontend/src/features/wallet/wallet.test.tsx` ("shows total, committed and available in reais"); `journey.test.tsx` | Coberto |
| 3.2 Disponível = Total - Comprometido (nunca negativo) | `backend/src/modules/wallet/rules.test.ts`; `wallet.test.ts` ("refuses committed above total even when written directly", "refuses a negative balance when written directly") | Coberto |
| 3.3 Limites de depósito (R$ 1,00 a R$ 100.000,00) e validação | `wallet.test.ts` ("accepts exactly the minimum and the maximum deposit"); `journey.test.tsx`; `frontend/src/lib/format.test.ts` | Coberto |
| 3.4 Concorrência: depósitos simultâneos somam corretamente e chave idempotente evita crédito duplicado | `wallet.test.ts` ("sums simultaneous deposits with different keys", "credits exactly once when many identical requests race with the same key") | Coberto |

## J4: Sala ao Vivo e Lances

| Critério | Descrição | Testes | Situação |
|---|---|---|---|
| 4.1 | Sala ao vivo: lance atual, histórico, posição do licitante, contagem regressiva, indicação de liderança ou superado sem recarregar | `frontend/src/features/lots/bidding.test.tsx`; `backend/tests/integration/bidding.test.ts` | Coberto |
| 4.2 | Lances aceitos apenas em lote ao vivo; primeiro lance >= inicial; lances seguintes >= atual + incremento | `rules.test.ts`; `bidding.test.ts` | Coberto |
| 4.3 | Mensagens de recusa com motivo exato em português: abaixo do mínimo, saldo insuficiente, já líder, não iniciado, já encerrado | `backend/tests/integration/bidding.test.ts`; `frontend/src/features/lots/bidding.test.tsx`; `backend/src/modules/bidding/rules.test.ts` | Coberto |
| 4.4 | Licitante líder não pode cobrir seu próprio lance | `rules.test.ts` ("refuses the current leader with already_leading"); `bidding.test.ts` | Coberto |
| 4.5 | Saldo comprometido enquanto líder, liberado imediatamente ao ser superado | `rules.test.ts`; `bidding.test.ts` | Coberto |
| 4.6 | Anti-sniping: lance nos últimos 2 minutos estende o encerramento em exatamente 2 minutos | `rules.test.ts` ("anti-sniping ..." com 6 casos); `bidding.test.ts` | Coberto |
| 4.7 | Lances concorrentes no mesmo instante: apenas um assume a liderança | `bidding.test.ts` ("20 bidders at the same instant ...") | Coberto |
| 4.8 | Mesmo saldo disputando dois lotes simultâneos nunca fica negativo | `bidding.test.ts` ("bids crossing between two lots ...") | Coberto |
| 4.9 | Contagem regressiva sincronizada com o relógio do servidor, imune a relógio desregulado no cliente | `frontend/src/features/lots/clock.test.ts` | Coberto |

## J5: Encerramento e Liquidação

| Critério | Descrição | Teste | Situação |
|---|---|---|---|
| 5.1 | Encerramento automático no horário previsto mesmo sem nenhum visitante na página | `backend/tests/integration/settlement.test.ts`, `settlement-on-demand.test.ts` | Coberto |
| 5.2 | Vencedor paga, leiloeiro recebe crédito, saldos de lances superados liberados, recibo gravado | `settlement.test.ts` | Coberto |
| 5.3 | Lote sem lances encerra normalmente sem vencedor | `settlement.test.ts` | Coberto |
| 5.4 | Idempotência sob concorrência de múltiplos disparos de liquidação | `settlement.test.ts` (dez execuções paralelas) | Coberto |
| 5.5 | Conservação de moeda: transferência sem criação ou perda de saldo | `settlement.test.ts` | Coberto |
| | Recusa de liquidação se a cópia da ponta divergir da cadeia criptográfica | `settlement.test.ts` | Coberto |

## J6: Meus Arremates e Comprovante de Vitória

| Critério | Testes | Situação |
|---|---|---|
| 6.1 Listagem de lotes participados e arrematados com código de comprovante | `backend/tests/integration/receipts.test.ts`; `backend/src/modules/receipts/rules.test.ts`; `frontend/src/features/wins/wins.test.tsx` | Coberto |
| 6.2 Link compartilhável com código aleatório, acessível sem login | `receipts.test.ts`; `wins.test.tsx` | Coberto |
| 6.3 Comprovante exibe apenas pseudônimo público do vencedor | `receipts.test.ts` | Coberto |
| 6.4 Isolamento: ninguém acessa comprovante de outro usuário sem o código | `receipts.test.ts` (404 para código inexistente, 401 sem token, 403 para leiloeiro) | Coberto |

## J7: Auditoria Pública Independente

| Critério | Testes | Situação |
|---|---|---|
| 7.1 Histórico completo com pseudônimos criptográficos estáveis | `backend/tests/integration/audit.test.ts`; `frontend/src/features/audit/audit.test.tsx` | Coberto |
| 7.2 Veredito de integridade: íntegro ou adulterado, indicando exatamente onde a cadeia quebra | `audit.test.ts`; `audit.test.tsx` | Coberto |
| 7.3 Detecção de valor alterado, lance removido no meio, último lance excluído, lance inserido, ordem trocada e alteração direta no banco | `audit.test.ts`; `backend/src/shared/bid-chain.test.ts`; `backend/tests/integration/audit-anchor.test.ts`; `frontend/src/features/audit/audit.test.tsx` | Coberto |
| 7.4 Ausência total de dados pessoais ou identificadores internos no histórico | `audit.test.ts` (sem nomes, e-mails, user_ids ou segredos) | Coberto |
| 7.5 Explicação detalhada da integridade no README | `README.md`, seção "Como a auditoria funciona" | Coberto |

## J8: Requisitos Transversais

| Critério | Testes | Situação |
|---|---|---|
| 8.1 Dados de demonstração (seed): leiloeiro, dois licitantes com saldo, lote ao vivo com lances e seis lotes agendados do acervo | `backend/tests/integration/seed.test.ts`; `README.md` | Coberto |
| 8.2 Deploy público verificado | `make e2e-prod` (`backend/scripts/e2e-deployed.ts` passou com 6 de 6 fluxos em produção) | Coberto |
| 8.3 Documentação viva e instruções fiéis ao código | `README.md`, `docs/DECISIONS.md`, `docs/BACKLOG.md` | Coberto |
| 8.4 Formato único e consistente de respostas de erro da API | `failures.test.ts`; asserções em testes de integração | Coberto |
| 8.5 Dados de demonstração com lote encerrado arrematado e lote com histórico adulterado para prova de auditoria | `seed.test.ts` | Coberto |
| 8.6 Acessibilidade de foco e título de página para cada tela | `frontend/src/app/navigation.test.tsx` | Coberto |
| 8.7 Mensagens de falha de login com causa clara e redirecionamento de retorno | `frontend/src/features/auth/auth.test.tsx`; `journey.test.tsx` | Coberto |
| 8.8 Responsividade sem overflow horizontal de 320 px a 1280 px com alvos de toque >= 44 px | `e2e/overflow.spec.ts`; medição em Playwright | Coberto |
| 8.9 Sala ao vivo com tratamento de erros, recuperação e anti-sniping visível | `frontend/src/features/lots/bidding.test.tsx` | Coberto |
| 8.10 Auditoria e comprovante destacam a quebra da cadeia quando adulterado | `frontend/src/features/audit/audit.test.tsx`; `frontend/src/features/wins/receipt.test.tsx` | Coberto |
| 8.11 Polling da vitrine pausa quando a aba do navegador fica oculta | `frontend/src/features/lots/showcase.test.tsx` | Coberto |
| 8.12 Link "Histórico" abre a âncora correta; reconexão progressiva na sala ao vivo | `frontend/src/features/lots/showcase.test.tsx`; `frontend/src/features/lots/bidding.test.tsx` | Coberto |
| 8.13 Menu de conta sem repetição desnecessária de saldo e contraste adequado no tema escuro | `frontend/src/journey.test.tsx` | Coberto |
| 8.14 Busca vazia exibe destaques do acervo com termos em português traduzidos pelo glossário | `backend/src/modules/catalog/translate.test.ts`; `backend/tests/integration/catalog.test.ts` | Coberto |
| 8.15 Carrossel automático no destaque sem repetição de lotes na listagem inferior | `frontend/src/features/lots/showcase.test.tsx` | Coberto |

## J9: Requisitos Opcionais do Enunciado

| Critério | Testes | Situação |
|---|---|---|
| Busca e filtro de lotes por título e estado | Ver critério 2.3 | Coberto |
| Testes automatizados com cobertura global | `make ci` (backend, frontend e contratos) | Coberto |
| 9.1 Cancelamento de lote com estorno automático | `backend/tests/integration/cancel-refund.test.ts`; `frontend/src/features/lots/results.test.tsx` | Coberto |
| 9.2 Docker Compose para execução completa dos serviços | `make compose` verificado em ambiente Linux | Coberto |
| 9.3 Tema claro e escuro persistido com alternância instantânea | `frontend/src/app/theme.test.tsx` | Coberto |
| Responsividade e acessibilidade completas (D46) | `e2e/overflow.spec.ts`, `e2e/accessibility.spec.ts` (axe-core), `e2e/journeys.spec.ts` | Coberto |
