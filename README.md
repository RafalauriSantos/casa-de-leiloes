# Casa de Leilões

Casa de leilões online para o teste técnico Verzel "Elite Dev". Leiloeiros publicam lotes a partir de itens do acervo público do The Met. Licitantes depositam saldo simulado, acompanham os lotes ao vivo, dão lances e, se vencerem, recebem um comprovante. Qualquer pessoa, sem login, audita o histórico de lances de um lote.

## Acesse

- **Site:** https://casadeleiloes.vercel.app
- **Contas de demonstração** (senha `demo-leilao-2026`):
  - leiloeiro: `leiloeiro@demo.example`
  - licitantes: `licitante1@demo.example` e `licitante2@demo.example`
- Os três logins respondem em produção.
- Abra `/auditoria/<id-do-lote>` para auditar um lote sem login.

## Rodar localmente

Requisitos: Node 22 (versão do `.nvmrc`), Docker em execução, `make` e `openssl`.

```bash
npm ci
make db-up     # sobe o Supabase local (Postgres e Auth) e aplica as migrations
make dev       # API em http://localhost:8787 e site em http://localhost:5173
make seed      # cria os dados de demonstração; rode com a API no ar, em outro terminal
```

- `make seed` cria um leiloeiro e dois licitantes com saldo. Cria três lotes de demonstração (um ao vivo com lances, um encerrado arrematado pelo licitante 1 e um encerrado com o histórico alterado no banco, que a auditoria mostra como adulterado) e seis lotes agendados com itens do The Met. Rodar de novo reaproveita os lotes, sem duplicar.
- `make db-reset` recria o banco local do zero. Visto em execuções de `make ci` sobre banco reaproveitado; a causa não foi isolada. `make db-reset` ou `make ci-local` dão um banco limpo.
- `make compose` sobe API e site em contêineres, depois de `make db-up`.

## Testes

- `make ci` roda lint, tipos, build, testes com cobertura e `npm audit`.
- `make ci-local` roda o mesmo `make ci` como o GitHub Actions (`.github/workflows/ci.yml`): Node do `.nvmrc`, Supabase local recriado do zero (apaga o banco local), sem seed e com ambiente limpo. Use-o quando o GitHub Actions não estiver disponível.
- `make e2e-browser` roda 14 testes em navegador real: jornadas, acessibilidade e largura da tela de 320 a 1280 px.
- `make e2e-live` consulta a API real do The Met. Não roda no `make ci`.

## Deploy

1. O site e a API ficam no mesmo projeto Vercel (`vercel.json`). O banco e o login ficam no Supabase.
2. Aplique as migrations em `supabase/migrations`, em ordem, no projeto Supabase.
3. No Supabase, desligue "Confirm email" em Auth.
4. Configure as variáveis de `.env.example` no Vercel. `ANCHOR_MODE` é obrigatório: `github` em produção e `off` em preview e local. Com `github`, também são obrigatórios `ANCHOR_GITHUB_REPO` (repositório da âncora) e `ANCHOR_GITHUB_TOKEN`.
5. Agende o encerramento a cada minuto com `npx tsx backend/scripts/schedule-close-due.ts` (usa `DATABASE_URL`, `CRON_SECRET` e `APP_URL`). O mesmo agendamento publica as pontas na âncora. Com `ANCHOR_MODE=github`, sem ele nenhum lote com lances é liquidado.

## Requisitos do enunciado

| Requisito | Situação |
|---|---|
| Deploy publicado | https://casadeleiloes.vercel.app |
| Papéis leiloeiro e licitante | Implementados |
| Vitrine com abas Ao vivo, Agendados e Encerrados | Implementada |
| Painel do leiloeiro: buscar, criar, cancelar, ver resultado e total recebido | Implementado |
| Sala ao vivo: contagem, posição do licitante e atualização a cada 3 s | Implementada |
| Carteira: total, comprometido, disponível e depósito simulado | Implementada |
| Meus arremates com comprovante e link | Implementado |
| Auditoria pública com veredito | Implementada |
| Mensagens de recusa com o motivo | Implementadas |
| Anti-sniping de 2 minutos | Implementado |
| Seed: leiloeiro, dois clientes e lote com lances | `make seed` |
| Opcional: busca de lotes | Implementada (por título) |
| Opcional: cancelamento com estorno | Implementado |
| Opcional: Docker Compose | `make compose` |
| Opcional: testes automatizados | `make ci` |
| Opcional: tema claro e escuro | Implementado |

## Comportamentos inesperados

- **Depósito simulado:** é saldo fictício. Cada depósito vai de R$ 1,00 a R$ 100.000,00.
- **Chave de depósito:** repetir a mesma chave não credita de novo, e a mesma chave com outro valor é recusada. A chave fica na página aberta: recarregar a página gera outra.
- **Papel fixo:** o papel escolhido no cadastro não muda depois. Leiloeiro não tem carteira nem dá lances.
- **Extensão do lote:** lance nos últimos 2 minutos estende o fim em 2 minutos, sem limite de extensões.
- **Limite de lances:** cada lote aceita 1.000 lances.
- **Pagamento espera a publicação:** ao encerrar, o lote só é pago depois que o hash do último lance está na âncora pública. Enquanto espera, o valor do líder continua reservado.
- **Catálogo do The Met:** a busca mostra 12 itens por página, só de domínio público e com imagem. Títulos e atributos ficam em inglês, exceto termos de um glossário (ex.: "Clock" → "Relógio").
- **Auditoria:** a página diz "Íntegro até o lance N" ou "Sem divergência até o lance M", nunca "íntegro" para o lote inteiro. "Não confirmado" não é acusação; "adulterado" aparece quando a cadeia quebra ou a âncora contradiz o histórico.
- **Contas de demonstração são públicas:** qualquer pessoa entra como leiloeiro demo e pode cancelar o lote ao vivo.

## Limites conhecidos

- **Publicação da âncora:** o cron roda a cada minuto. Quem acessa o banco diretamente pode apagar o último lance antes da publicação; só o recibo do licitante detecta esse caso.
- **Sem releitura da âncora antes do pagamento:** o sistema confere o histórico no banco, mas não relê o arquivo no GitHub antes de pagar.
- **Sem aviso ao vencedor:** nenhum e-mail ou mensagem é enviado.
- **Âncora indisponível:** a auditoria mostra "Âncora não verificada" e não afirma nada sobre ela.
- **Sala ao vivo:** mostra os 50 lances mais recentes; a posição de "superado" considera o histórico inteiro.
- **Vitrine:** mostra até 60 lotes por lista.
- **Busca no catálogo:** cada busca faz até 13 requisições ao Met (1 busca e até 12 detalhes), sem cache.
- **Sessão no `localStorage`:** padrão do Supabase Auth. A política de conteúdo (CSP) reduz o risco, mas não impede que um script já presente na página leia a sessão.
- **Logout:** encerra a sessão em todos os dispositivos, mas o token já emitido vale no servidor até expirar (1 hora).
- **Sem confirmação de e-mail:** o cadastro cria a conta na hora. A confirmação não foi implementada.
- **Layout em celular:** o teste de navegador cobre estouro horizontal em 320, 360, 390, 768 e 1280 px. Não há teste visual em aparelho real.
- **Carrossel do destaque:** gira a cada 5 segundos e para com mouse, foco, botão ou preferência de movimento reduzido. Se o lote em destaque sair da lista com o mouse em cima, a pausa continua até o próximo mouse.

## Como a auditoria funciona

- Cada lance vira um elo de uma cadeia HMAC: o hash de cada lance depende do anterior e de um segredo que só o servidor tem (`AUDIT_HMAC_SECRET`). Alterar, inserir, reordenar ou remover um lance do meio quebra a cadeia. Remover o último lance não quebra a cadeia: só o recibo (antes da publicação) ou a âncora (depois dela) detectam.
- Cada licitante aparece por um pseudônimo derivado do HMAC, estável dentro do lote e diferente entre lotes. Os horários públicos são mostrados até o segundo.
- O hash de cada lance é publicado, uma linha por lance, em um arquivo por lote no repositório da âncora (GitHub). Depois que o hash está publicado, reescrever a cadeia no banco faz a auditoria divergir da âncora.
- O recibo de arremate guarda a ponta do lote. Colar a ponta na auditoria mostra se ela está no histórico.

## Uso de IA

O código, os testes, as migrations, a documentação e as revisões foram feitos com apoio de IA (Claude Code), com aprovação do dono do projeto em cada entrega. Detalhes e erros da IA estão em [docs/AI-USAGE.md](docs/AI-USAGE.md).
