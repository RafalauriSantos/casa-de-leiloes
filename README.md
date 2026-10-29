# Casa de Leilões

Casa de leilões online, feita para o teste técnico Verzel "Elite Dev". Leiloeiros publicam lotes com itens do acervo público do The Met. Licitantes depositam saldo simulado, dão lances e, se vencerem, recebem um comprovante. Qualquer pessoa audita o histórico de lances de um lote, sem login.

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
- `make db-reset` recria o banco local do zero. Num banco reaproveitado, `make ci` deu erros 409 em testes de lance algumas vezes. Não isolei a causa; com banco limpo, o erro não aparece.
- `make compose` sobe API e site em contêineres, depois de `make db-up`.

## Testes

- `make ci`: lint, tipos, build, testes com cobertura e `npm audit`. É a definição de verde que eu usei.
- `make ci-local`: roda o mesmo `make ci` como o GitHub Actions (`.github/workflows/ci.yml`), com Node do `.nvmrc`, Supabase recriado do zero (apaga o banco local), sem seed e com ambiente limpo. Eu usei esse comando para validar as entregas quando o GitHub Actions não tinha minutos.
- `make e2e-browser`: 14 testes em navegador real, com jornadas, acessibilidade e largura de tela de 320 a 1280 px.
- `make e2e-live`: consulta a API real do The Met. Não roda no `make ci`.

## Deploy

1. Use um projeto Vercel para o site e a API (`vercel.json`), e um projeto Supabase para o banco e o login.
2. Aplique as migrations de `supabase/migrations`, em ordem, no projeto Supabase.
3. Desligue "Confirm email" em Auth no Supabase.
4. Configure no Vercel as variáveis de `.env.example`. `ANCHOR_MODE` é obrigatório: `github` em produção e `off` em preview e local. Com `github`, também são obrigatórios `ANCHOR_GITHUB_REPO` e `ANCHOR_GITHUB_TOKEN`.
5. Agende o encerramento a cada minuto com `npx tsx backend/scripts/schedule-close-due.ts`. O mesmo agendamento publica as pontas na âncora. Com `ANCHOR_MODE=github`, sem ele nenhum lote com lances é liquidado.

## O que foi feito

| Requisito do enunciado | Situação |
|---|---|
| Deploy publicado | Feito |
| Papéis leiloeiro e licitante | Feito |
| Vitrine com abas Ao vivo, Agendados e Encerrados | Feito |
| Painel do leiloeiro: buscar, criar, cancelar, ver resultado e total recebido | Feito |
| Sala ao vivo com contagem, posição e atualização a cada 3 s | Feito |
| Carteira com total, comprometido, disponível e depósito simulado | Feito |
| Meus arremates com comprovante e link | Feito |
| Auditoria pública com veredito | Feito |
| Mensagens de recusa com o motivo | Feito |
| Anti-sniping de 2 minutos | Feito |
| Seed com leiloeiro, dois clientes e lote com lances | Feito |
| Opcional: busca de lotes (por título) | Feito |
| Opcional: cancelamento com estorno | Feito |
| Opcional: Docker Compose | Feito |
| Opcional: testes automatizados | Feito |
| Opcional: tema claro e escuro | Feito |

## Comportamentos inesperados

- **Depósito simulado:** é saldo fictício, de R$ 1,00 a R$ 100.000,00 por depósito.
- **Chave de depósito:** repetir a mesma chave não credita de novo. A mesma chave com outro valor é recusada. A chave fica na página aberta: recarregar a página gera outra.
- **Papel fixo:** o papel escolhido no cadastro não muda depois. Leiloeiro não tem carteira nem dá lances.
- **Extensão do lote:** lance nos últimos 2 minutos estende o fim em 2 minutos, sem limite de extensões.
- **Limite de lances:** cada lote aceita 1.000 lances.
- **Pagamento espera a publicação:** ao encerrar, o lote só é pago depois que o hash do último lance está na âncora pública. Enquanto isso, o valor do líder continua reservado.
- **Catálogo do The Met:** a busca mostra 12 itens por página, só de domínio público e com imagem. Títulos e atributos ficam em inglês, exceto termos de um glossário (ex.: "Clock" → "Relógio").
- **Auditoria:** a página diz "Íntegro até o lance N" ou "Sem divergência até o lance M", nunca "íntegro" para o lote inteiro. "Não confirmado" não é acusação; "adulterado" aparece só quando a cadeia quebra ou a âncora contradiz o histórico.
- **Contas de demonstração são públicas:** qualquer pessoa entra como leiloeiro demo e pode cancelar o lote ao vivo.

## Limites e o que não fiz

- **Publicação da âncora:** o cron roda a cada minuto. Quem acessa o banco diretamente pode apagar o último lance antes da publicação; só o recibo do licitante detecta esse caso.
- **Sem releitura da âncora antes do pagamento:** o sistema confere o histórico no banco, mas não relê o arquivo no GitHub antes de pagar.
- **Sem aviso ao vencedor:** nenhum e-mail ou mensagem é enviado.
- **Âncora indisponível:** a auditoria mostra "Âncora não verificada" e não afirma nada sobre ela.
- **Sala ao vivo:** mostra os 50 lances mais recentes; a posição de "superado" considera o histórico inteiro.
- **Vitrine:** mostra até 60 lotes por lista.
- **Busca no catálogo:** cada busca faz até 13 requisições ao Met (1 busca e até 12 detalhes), sem cache.
- **Sessão no `localStorage`:** é o padrão do Supabase Auth. A política de conteúdo (CSP) reduz o risco, mas não impede que um script já presente na página leia a sessão.
- **Logout:** encerra a sessão em todos os dispositivos, mas o token já emitido vale no servidor por até 1 hora.
- **Sem confirmação de e-mail:** o cadastro cria a conta na hora. Não implementei a confirmação.
- **Celular:** o teste de navegador cobre estouro horizontal de 320 a 1280 px. Não testei o visual em aparelho real.
- **Carrossel do destaque:** gira a cada 5 segundos e para com mouse, foco, botão ou preferência de movimento reduzido. Se o lote em destaque sair da lista com o mouse em cima, a pausa continua até o próximo mouse.

## Como a auditoria funciona

- Cada lance é um elo de uma cadeia HMAC: o hash de cada lance depende do anterior e de um segredo que só o servidor tem (`AUDIT_HMAC_SECRET`). Alterar, inserir, reordenar ou remover um lance do meio quebra a cadeia. Remover o último lance não quebra a cadeia: só o recibo (antes da publicação) ou a âncora (depois dela) detectam.
- Cada licitante aparece por um pseudônimo derivado do HMAC, estável dentro do lote e diferente entre lotes. Os horários públicos aparecem até o segundo.
- O hash de cada lance é publicado, uma linha por lance, em um arquivo por lote no repositório da âncora (GitHub). Depois da publicação, reescrever a cadeia no banco faz a auditoria divergir da âncora.
- O recibo de arremate guarda a ponta do lote. Colar a ponta na auditoria mostra se ela está no histórico.

## Uso de IA

Usei IA (Claude Code) para escrever código, testes, migrations, documentação e revisões, e conferi cada entrega antes do merge. Detalhes, o que revisei e os erros da IA estão em [docs/AI-USAGE.md](docs/AI-USAGE.md).
