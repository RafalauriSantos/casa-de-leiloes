# Backlog

Itens de trabalho do projeto, concluídos e pendentes. Os critérios de aceitação detalhados estão mapeados em `docs/TRACEABILITY.md` (critérios J0 a J8, derivados do enunciado técnico) e nas decisões registradas em `docs/DECISIONS.md`. Um item é considerado concluído quando seus critérios estão cobertos e verificados por testes.

Níveis de risco:
- **Alto** (dinheiro, lances, liquidação, autenticação, permissões, migrations de banco): exige testes com mutação por regra, revisão minuciosa e autorização explícita do proprietário.
- **Normal**: revisão e aprovação pela esteira automatizada verde de integração contínua (`make ci`).

## Concluídos

| Item | Critérios | Decisões | PR / Branch |
|---|---|---|---|
| Walking skeleton: monorepo, CI, Supabase, deploy Vercel, agendador por minuto | 8.2 | D1, D2 | #1 |
| Acesso e carteira: bloqueio por perfil, depósito simulado idempotente, livro-razão somente anexação | 0.1 a 0.5, 3.1 a 3.4 | D3, D9 | #2, #3 |
| Busca no catálogo, lotes e vitrine pública | 1.1 a 1.3, 1.5, 1.6, 1.8, 2.1, 2.3, 2.4 | D17 | #4, #5, #9 |
| Lances, sala ao vivo e histórico de lances encadeado por HMAC | 1.9, 4.2, 4.4 a 4.8 | D4, D18 | #6, #7 |
| Barra de qualidade e matriz de rastreabilidade | | | #8 |
| Liquidação: lotes vencidos, comprovantes, gatilhos sob demanda, recusa de histórico adulterado | 5.1 a 5.5 | D6 | #10, #11 |
| Comprovante de lance com a ponta da cadeia criptográfica | 7.3 | D21 | #13 |
| Âncora pública no GitHub: regras de consistência e publicador | 7.3 | D21 | #14, #15 |
| Auditoria pública: rota independente, detecção do primeiro lance rompido, âncora, cabeçalho e página | 7.1 a 7.5 | D22 | #16 a #22 |
| Limite de 1.000 lances por lote | | D23 | #23 |
| Pagamento condicionado à publicação do último lance na âncora | | D21 | #24 |
| Liberação pelo proprietário de lote cujo histórico falhe na verificação | 7.2 | D20 | #12, #25 |
| Decisão arquitetural: sem releitura da âncora antes do pagamento | | D21 | #26 |
| Destaque de lotes ao vivo na vitrine | 2.1 | D34 | #27 |
| Ponto indicador verde apenas quando há lote ao vivo; suíte sem deixar lotes abertos | 2.1, 2.5 | | #28 |
| "Meus arremates" e comprovante de vitória compartilhável | 6.1 a 6.4 | Alto | #30 |
| Seed rica de demonstração: leiloeiro, dois licitantes com saldo, lote ao vivo com lances | 8.1 | Normal | #31 |
| Painel do leiloeiro: resultado de cada lote encerrado e total recebido consolidado | 1.7 | Normal | #33 |
| Script ponta a ponta em produção (`make e2e-prod`) | 8.2 | Normal | #36 |
| Quebra de linha responsiva da ponta do recibo no celular (sem scroll lateral na sala ao vivo) | | Normal | #32 |
| Contagem regressiva em dias quando restar mais de 24 horas | | Normal | #34 |
| Contagem regressiva baseada no relógio do servidor (aritmética pura testada) | 4.1, 4.9 | Normal | #39 |
| Otimização de CI: apenas em pull requests, cancelamento de execuções obsoletas | | Normal | #37 |
| Tratamento de indisponibilidade do acervo do The Met na busca | 1.4 | Normal | #42 |
| Card da vitrine exibe lance atual quando há lances; tratamento de erro com nova tentativa | 2.2, 2.5 | Normal | #42 |
| Mensagens de recusa assertivas para "não iniciado" e "já encerrado" | 4.3 | Normal | #43 |
| Ponto "Ao vivo" desliga sozinho quando o último lote encerra sem necessidade de reload | 2.1 | Normal | #43 |
| Seed com seis objetos reais do acervo do The Met com variedade de categorias | 8.1 | Normal | #46 |
| Busca paginada no acervo do The Met com glossário traduzido para termos artísticos | 1.1, D28, D48 | Normal | #47 |
| Redesign editorial da vitrine: destaque heróico único e catálogo em grid de 4 colunas com paginação | 2.1, 2.2 | D50 | #103 |
| Responsividade mobile em viewports estreitos (320px a 390px): abas em 3 colunas compactas e 0px overflow | 2.1, 2.2 | D50 | `fix/showcase-mobile` |
| Carrossel com pausa automática acessível por foco (`:focus-within`), hover e movimento reduzido (sem botão) | 2.1 | D51 | `fix/showcase-mobile` |
| Suporte a milhões e formatação dinâmica de moedas em tempo real (`1.000.000,00`) com pontos e vírgula | 3.3 | D52 | `fix/showcase-mobile` |
| Eliminação da concorrência e piscada de lotes na alternância entre abas da vitrine | 2.1, 2.5 | D52 | `fix/showcase-mobile` |
| Enquadramento natural de imagens sem corte de laterais nem zoom agressivo (`object-fit: contain`) | 2.2 | D52 | `fix/showcase-mobile` |

## Em aberto / Melhorias contínuas

| # | Item | Critérios | Risco | Condição de conclusão |
|---|---|---|---|---|
| B10 | Cabeçalhos de segurança avançados (CSP rígido e afins) no `vercel.json` | | Normal | Resposta em produção sem bloqueios de scripts legítimos |
| B11 | Monitoramento diário de saúde da âncora pública do GitHub | | Normal | Rotina de teste automatizado diário do repositório da âncora |
| B34 | Extrato completo de movimentações na carteira do licitante (depósitos e reservas) | 3.1 | Alto | Endpoint dedicado sobre o livro-razão com autorização e testes |
| B49 | Alerta ao administrador se um lote encerrado aguardar mais de 10 minutos para publicação | | Normal | Definição de canal (webhook, Discord, e-mail) |

## Ações administrativas externas (fora do código)

- Manter o repositório principal público sem segredos no histórico.
- Proteger a branch `main` do repositório público de ancoragem (`casa-de-leiloes-ancora`).
