# Casa de Leilões

Casa de leilões online (teste técnico Verzel "Elite Dev"). **Em construção**: hoje existem cadastro, login, papéis, carteira com depósito simulado, e a vitrine com lotes publicados a partir do catálogo público do The Met. Lances, comprovante e auditoria entram nas próximas etapas.

Decisões de design e seus tradeoffs: [docs/DECISIONS.md](docs/DECISIONS.md).

## Rodar localmente

Requisitos: Node 22, Docker (rodando), `make` e `openssl`.

```bash
npm ci
make db-up      # sobe o Supabase local (Postgres e Auth reais) e aplica supabase/migrations sozinho
make dev        # API em http://localhost:8787 e site em http://localhost:5173
make ci         # lint, tipos, build, testes com cobertura e npm audit (a única definição de verde)
make e2e-live   # bate na API real do The Met (não roda no ci; use antes de publicar)
```

- `make test`, `make dev` e `make ci` exigem `make db-up` antes (portas 54321 da API/Auth e 54322 do Postgres).
- `make db-reset` recria o banco local do zero a partir das migrations.
- Os segredos locais (cadeia de auditoria e cron) são gerados uma vez em `.env.dev-secrets` (fora do Git); apague o arquivo para trocá-los. Variáveis já definidas no seu ambiente têm prioridade sobre o arquivo.

## Produção (Vercel + Supabase)

- Site e API no mesmo projeto Vercel (Vercel Services: `frontend/` e `backend/`, rota `/api/*` para o back). A branch de produção é `main`.
- Variáveis (Vercel, ambiente Production): `DATABASE_URL` (pooler de transação, porta 6543, com `?sslmode=require`), `SUPABASE_URL`, `AUDIT_HMAC_SECRET`, `CRON_SECRET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Modelo em `.env.example`. As `VITE_*` são lidas **na hora do build** do site.
- Âncora pública do histórico (D21): `ANCHOR_MODE` é obrigatório (`github` em produção, `off` no desenvolvimento local e nos testes; sem ele o servidor não sobe). Com `github`, também são obrigatórios `ANCHOR_GITHUB_REPO` (`dono/repositorio`) e `ANCHOR_GITHUB_TOKEN` (token do GitHub só para esse repositório, permissão *Contents* com escrita; na Vercel, marcado como sensível). Opcionais: `ANCHOR_GITHUB_BRANCH` (padrão `main`) e `ANCHOR_GITHUB_API_URL`. Nos deploys de *Preview*, use `ANCHOR_MODE=off`. O mesmo cron de cada minuto liquida os lotes e depois publica as pontas pendentes; se uma publicação falhar ou ficar pendente por 10 minutos ou mais, o cron responde HTTP 500 (ninguém é avisado ainda por e-mail ou mensagem: o registro fica em `net._http_response` do Supabase). Ao ligar a âncora pela primeira vez, os lotes antigos com lances são publicados aos poucos, e o cron responde 500 por alguns minutos até terminar.
- No Supabase: aplicar `supabase/migrations` em ordem (arquivo por arquivo, ou `npx supabase db push --db-url "$DATABASE_URL"`), desligar "Confirm email" (Auth > Sign In / Providers) e manter as chaves de assinatura assimétricas.
- Encerramento agendado (a cada minuto): `DATABASE_URL=... CRON_SECRET=... APP_URL=https://<dominio> npx tsx backend/scripts/schedule-close-due.ts`. Guarda URL e segredo no Vault do Supabase. Um lote vencido também é liquidado quando alguém o abre, dá lance nele ou consulta a carteira de quem lidera. O endpoint do cron liquida os lotes vencidos que ninguém abriu: o vencedor paga, o leiloeiro recebe, quem foi superado já teve o valor liberado e um comprovante fica gravado. Um lote que não confere com o próprio histórico não é liquidado e a resposta do endpoint vem com HTTP 500 e o contador `failed` maior que zero. Um lote com falha continua vencido e é tentado de novo a cada minuto, até que a falha seja corrigida.

## Arquitetura e domínio (DDD, na medida do tamanho do projeto)

O código segue as ideias do DDD que valem a pena num projeto desse tamanho, sem as camadas que só adicionariam código:

- **Linguagem do domínio:** os nomes do código são os do leilão: lote, lance, ponta (o hash do último lance), recibo, liquidação, âncora, auditoria.
- **Áreas separadas por funcionalidade** (`backend/src/modules`: `lots`, `bidding`, `wallet`, `settlement`, `anchor`, `audit`, `catalog`, `identity`), cada uma só enxergável pelo seu `index.ts`. A regra de negócio fica em `rules.ts` (funções puras, sem banco, rede nem relógio próprio), o SQL em `service.ts` e o HTTP em `routes.ts`. O `make ci` impede que uma área acesse as entranhas de outra.
- **O lote é o ponto de consistência:** todo lance e toda liquidação travam a linha do lote, e as carteiras na mesma ordem, dentro de uma transação. É isso que garante que dois lances simultâneos não passem e que o dinheiro não se perca.
- **O que não usamos, de propósito:** interfaces de repositório e entidades com métodos. A garantia do dinheiro está nas transações do Postgres e nos testes com requisições paralelas reais, e uma camada de abstração esconderia a ordem dos travamentos. As decisões e seus custos estão em `docs/DECISIONS.md`.

## Comportamentos inesperados (declarados)

- **Depósito simulado:** a carteira é só um saldo fictício, sem pagamento real. Cada depósito vai de R$ 1,00 a R$ 100.000,00.
- **Depósito repetido:** cada depósito leva uma chave de idempotência. Clicar duas vezes ou repetir a requisição não credita duas vezes; usar a mesma chave com outro valor é recusado (409).
- **Só licitante tem carteira:** leiloeiro recebe 403 na carteira e não vê o menu "Carteira". Contas novas são sempre de licitante; o leiloeiro de demonstração virá do seed, que **ainda não existe** (planejado para a etapa final).
- **Chave de idempotência só na tela aberta:** ela vive na memória da página. Se o depósito foi creditado mas a resposta se perdeu, repetir o mesmo valor **sem recarregar a página** não credita de novo; recarregar a página antes de tentar outra vez gera uma chave nova e pode creditar duas vezes.
- **Livro-caixa sem edição:** movimentos de dinheiro não podem ser alterados nem apagados, e um usuário com histórico de depósito não pode ser excluído.
- **Cadastro sem confirmação de e-mail:** desligada de propósito para a demonstração; o provedor de e-mail do Supabase hospedado também recusa domínios reservados como `example.com`.
- **Catálogo do The Met:** a busca mostra no máximo 12 resultados e só itens de domínio público com imagem. Itens sem imagem pública não aparecem. Se o catálogo estiver fora, a busca e a criação de lote mostram erro; a vitrine e as páginas de lote continuam funcionando, porque lotes guardam uma cópia do item.
- **Limites conhecidos:** cada busca no catálogo faz até 13 requisições ao The Met (1 busca e até 12 detalhes), sem cache; a vitrine mostra até 60 lotes por lista; a sala mostra os 50 lances mais recentes (a posição de "superado" considera o histórico inteiro).
- **Horário:** o leiloeiro informa início e fim no horário de Brasília (UTC-03:00); o servidor guarda em UTC. A contagem de estado (agendado, ao vivo, encerrado) vem do relógio do banco, não do navegador.
- **Lances:** só licitantes dão lance, e só em lote ao vivo. O primeiro lance é pelo menos o lance inicial; os seguintes, pelo menos o lance atual mais o incremento. O líder não cobre o próprio lance. O valor comprometido fica bloqueado enquanto o lance lidera e volta ao disponível quando o licitante é superado.
- **Limite de lances por lote:** cada lote aceita no máximo 1.000 lances. O 1.000º é aceito e o 1.001º é recusado com a mensagem "Este lote atingiu o limite de 1.000 lances." (a sala também avisa e esconde o formulário). Motivo: a prova pública de cada lote é um arquivo de tamanho limitado, e um lote maior que isso não poderia ser publicado. Um lote cheio não aceita mais lances até o fim, mesmo que alguém pagasse mais.
- **Anti-sniping:** um lance feito nos últimos 2 minutos estende o fim do lote em 2 minutos (a partir do fim atual). Não há limite para essas extensões. Um lance exatamente no fim é recusado.
- **Histórico de lances:** cada lance tem um encadeamento criptográfico (HMAC com segredo que só existe no servidor). Os licitantes aparecem por pseudônimo, estável dentro do lote e diferente entre lotes, nunca pelo nome ou pela conta. Um lance não pode ser repetido por clique duplo: a segunda tentativa do mesmo líder recebe "você já está ganhando".
- **Sala ao vivo:** a tela consulta o estado a cada 3 segundos e pausa com a aba oculta. A contagem regressiva usa o relógio do servidor, não o do seu computador. Se a conexão falhar, a tela avisa que pode estar atrasada.
- **Editar e cancelar lote:** editar só antes do início e sem lances. Cancelar só sem lances e antes do fim (um lote ao vivo sem lances pode ser cancelado). Lote com lances não pode ser alterado nem cancelado.
- **Auditoria pública (`/auditoria/<lote>`):** qualquer pessoa, sem login, vê o histórico de lances (pseudônimo, valor, horário até o segundo e o hash de cada lance) e três resultados separados: a cadeia de hashes, a âncora pública (arquivo por lote no repositório `casa-de-leiloes-ancora`, no GitHub) e, se a pessoa informar a ponta do seu recibo, se essa ponta está no histórico. A página nunca diz que o lote inteiro está "íntegro": só "íntegro até o lance N" quando o recibo foi encontrado e a âncora confere, ou "sem divergência até o lance M publicado" quando não há recibo.
- **Janela de publicação (limite declarado):** o hash de um lance vai para a âncora pública em até cerca de 1 minuto depois do lance. Quem tem acesso direto ao banco poderia apagar o **último** lance dentro dessa janela e reescrever a ponta do lote; a âncora ainda não teria nada para comparar. Só o recibo guardado pelo licitante (a ponta) pega esse caso: a página responde "Não confirmado". A liquidação ainda não espera a publicação (planejado: o pagamento só sai depois do hash publicado).
- **"Não confirmado" não é acusação:** uma ponta que não está no histórico (digitada errada, de outro lote ou inventada) dá "Não confirmado" e nunca "Adulterado". "Adulterado" só aparece quando a cadeia está quebrada ou a âncora contradiz o histórico.
- **Âncora indisponível:** se o GitHub não puder ser lido na hora (fora do ar, limite de requisições, token recusado), a página diz "Âncora não verificada" e não afirma nada sobre ela. Cada leitura da âncora é guardada por 30 segundos e há um teto de 30 chamadas por minuto por servidor.
- **Logout:** encerra a sessão em todos os dispositivos; o token de acesso já emitido ainda vale no servidor até expirar (até 1 hora).
