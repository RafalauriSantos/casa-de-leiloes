# Casa de Leilões

Casa de leilões online, feita para o teste técnico Verzel "Elite Dev". Leiloeiros publicam lotes com itens do acervo público do The Met. Licitantes depositam saldo simulado, dão lances e, se vencerem, recebem um comprovante com cadeia criptográfica. Qualquer pessoa audita o histórico de lances de um lote, sem login.

## Acesse

- **Site:** https://casadeleiloes.vercel.app
- **Contas de demonstração** (senha `demo-leilao-2026`):
  - leiloeiro: `leiloeiro@demo.example`
  - licitantes: `licitante1@demo.example` e `licitante2@demo.example`
- Testei os três logins em produção.
- Abri `/auditoria/<id-do-lote>` em produção, sem login.

## Rodar localmente

Requisitos: Node 22 (versão do `.nvmrc`), Docker em execução, `make` e `openssl`.

```bash
npm ci
make db-up     # sobe o Supabase local (Postgres e Auth) e aplica as migrations
make dev       # API em http://localhost:8787 e site em http://localhost:5173
make seed      # cria os dados de demonstração (com a API no ar, em outro terminal)
```

- `make seed` cria um leiloeiro e dois licitantes com saldo, além de três lotes de demonstração: um ao vivo com lances, um encerrado arrematado pelo licitante 1 e um encerrado com o histórico alterado no banco, que a auditoria mostra como adulterado. Também cria seis lotes agendados com itens do The Met. Rodar de novo reaproveita os lotes.
- `make db-reset` recria o banco local do zero.
- `make compose` sobe API e site em contêineres, depois de `make db-up`.

## Testes e Qualidade

- `make ci`: lint, checagem de tipos, build de produção, testes automatizados (backend e frontend com cobertura mínima global de 85%) e `npm audit`. É a definição oficial de verde para merges.
- `make ci-local`: reproduz a esteira completa do GitHub Actions (`.github/workflows/ci.yml`) em ambiente limpo e isolado.
- `make e2e-browser`: suíte de testes em navegador real (Playwright), cobrindo jornadas de ponta a ponta, acessibilidade e responsividade visual sem transbordamento horizontal de 320 px a 1280 px.
- `make e2e-live`: consulta a API real do acervo do The Met.

## Deploy

1. Use um projeto Vercel para o site e a API (`vercel.json`), e um projeto Supabase para o banco de dados e autenticação.
2. Aplique as migrations de `supabase/migrations`, em ordem estrita, no projeto Supabase.
3. Desligue "Confirm email" em Auth no Supabase.
4. Configure no Vercel as variáveis descritas em `.env.example`. `ANCHOR_MODE` é obrigatório: `github` em produção e `off` em preview e local. Com `github`, também são obrigatórios `ANCHOR_GITHUB_REPO` e `ANCHOR_GITHUB_TOKEN`.
5. Agende o encerramento a cada minuto com `npx tsx backend/scripts/schedule-close-due.ts`. O mesmo agendamento publica as pontas na âncora pública do GitHub. Com `ANCHOR_MODE=github`, nenhum lote com lances é liquidado sem a publicação correspondente.

## O que foi feito

| Requisito do enunciado | Situação |
|---|---|
| Deploy publicado | Feito |
| Papéis leiloeiro e licitante | Feito |
| Vitrine editorial com abas Ao vivo, Agendados e Encerrados | Feito |
| Catálogo paginado com busca e paginação numérica (4 lotes por página) | Feito |
| Painel do leiloeiro: buscar no acervo, criar lote, cancelar com estorno, ver resultado e total recebido | Feito |
| Sala ao vivo com contagem regressiva pelo relógio do servidor, posição e polling dinâmico a cada 3 s | Feito |
| Carteira com total, comprometido, disponível e depósito simulado | Feito |
| Meus arremates com comprovante emitido e link direto de auditoria | Feito |
| Auditoria pública independente com veredito criptográfico e link da âncora | Feito |
| Mensagens de recusa com motivo exato em português | Feito |
| Anti-sniping automático de 2 minutos | Feito |
| Seed rica com leiloeiro, dois licitantes e lote ativo com lances reais | Feito |
| Suporte a milhões e digitação com formatação monetária padrão (pontos de milhar e vírgula) | Feito |
| Exibição natural de fotos de peças sem corte lateral nem zoom distorcido (`object-fit: contain`) | Feito |
| Transição suave entre abas da vitrine sem piscada de lotes desatualizados | Feito |
| Opcional: busca de lotes (por título e acervo) | Feito |
| Opcional: cancelamento com estorno automático | Feito |
| Opcional: Docker Compose | Feito |
| Opcional: testes automatizados com cobertura rigorosa | Feito |
| Opcional: tema claro e escuro persistido sem flash de renderização | Feito |

## Regras de negócio e comportamentos do sistema

- **Depósito simulado:** saldo fictício de R$ 1,00 a R$ 100.000,00 por operação.
- **Formatação monetária e suporte a milhões:** inputs de moeda aceitam valores até R$ 10.000.000,00 (`MAX_STARTING_BID_CENTS`), formatando milhares em tempo real à medida que são digitados (`1.000.000`) e padronizando com centavos (`1.000.000,00`) no desfoque (`blur`).
- **Chave de depósito idempotente:** repetir a mesma chave não credita duas vezes; valor divergente para a mesma chave é rejeitado.
- **Papel imutável:** o papel selecionado no cadastro (comprador ou vendedor) é permanente. Leiloeiros não possuem carteira de lances nem podem dar lances em lotes.
- **Anti-sniping:** qualquer lance aceito nos últimos 2 minutos do leilão estende automaticamente o prazo de encerramento em mais 2 minutos.
- **Limite por lote:** cada lote suporta até 1.000 lances consecutivos em sua cadeia.
- **Liquidação condicionada à âncora:** ao encerrar, o lote com vencedor só tem o pagamento transferido ao leiloeiro após a publicação do hash na âncora pública. Até lá, o valor permanece seguro e reservado na carteira do licitante líder.
- **Auditoria de lances:** a página reporta "Íntegro até o lance N" ou "Sem divergência até o lance M", baseando-se estritamente na verificação da cadeia de hashes HMAC. "Adulterado" surge apenas se houver quebra na cadeia ou contradição com o repositório público de ancoragem.
- **Enquadramento de imagens:** todas as peças do catálogo, vitrine e sala ao vivo utilizam proporção natural sem corte lateral de bordas ou zoom agressivo.

## Limitações conhecidas e escopo

- **Publicação da âncora:** o script de cron é disparado a cada minuto. O comprovante em posse do licitante permite auditar qualquer inconsistência mesmo antes da publicação do cron.
- **Notificação ao vencedor:** não há envio de e-mails transacionais externos. O vencedor visualiza o resultado e seu comprovante instantaneamente em "Meus arremates".
- **Sessão:** armazenada via JWT no `localStorage`, gerenciada pelo cliente oficial do Supabase Auth.
- **Carrossel do destaque ao vivo:** rotaciona automaticamente entre os lotes ao vivo a cada 5 segundos; pausa automaticamente ao posicionar o cursor do mouse (`:hover`), ao navegar por teclado ou focar o elemento (`:focus-within`), ou caso o usuário tenha ativado preferência de acessibilidade por redução de movimento (`prefers-reduced-motion`).

## Como conferir a auditoria independente

1. Acesse `/auditoria/<id-do-lote>` (o identificador consta na URL da página do lote). Não requer login.
2. Verifique o último hash registrado na cadeia de lances.
3. Abra o arquivo público correspondente no repositório da âncora: `https://github.com/RafalauriSantos/casa-de-leiloes-ancora/blob/main/lots/<id-do-lote>.csv` (acessível diretamente pelo botão "Ver o arquivo público da âncora no GitHub").
4. Confirme que cada hash da lista corresponde exatamente à sequência e timestamp registrados na âncora.

## Como funciona a integridade criptográfica

- Cada lance aceito constitui um elo de uma cadeia HMAC com chave secreta (`AUDIT_HMAC_SECRET`). O hash do lance corrente deriva diretamente do hash do lance anterior, dos dados do lance e da chave do servidor. Qualquer inserção, remoção ou reordenação corrompe a verificação.
- Licitantes são identificados por pseudônimos criptográficos estáveis para aquele lote, preservando privacidade sem comprometer a rastreabilidade.
- Cada recibo de arremate contém o hash da ponta da cadeia do lote, garantindo prova irrefutável ao vencedor.

## Uso de Inteligência Artificial

O desenvolvimento contou com auxílio de modelos de IA para aceleração de código, testes e documentação técnica, com rigorosa revisão humana em cada entrega, conferência manual em navegadores e dispositivos móveis, e execução local de `make ci` antes de cada merge. Detalhes completos e histórico de revisões em [docs/AI-USAGE.md](docs/AI-USAGE.md).
