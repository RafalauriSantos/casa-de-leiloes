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
- No Supabase: aplicar `supabase/migrations` em ordem (arquivo por arquivo, ou `npx supabase db push --db-url "$DATABASE_URL"`), desligar "Confirm email" (Auth > Sign In / Providers) e manter as chaves de assinatura assimétricas.
- Encerramento agendado (a cada minuto): `DATABASE_URL=... CRON_SECRET=... APP_URL=https://<dominio> npx tsx backend/scripts/schedule-close-due.ts`. Guarda URL e segredo no Vault do Supabase. **Por enquanto o endpoint só responde que não há nada a encerrar**: a liquidação real chega com os lotes.

## Comportamentos inesperados (declarados)

- **Depósito simulado:** a carteira é só um saldo fictício, sem pagamento real. Cada depósito vai de R$ 1,00 a R$ 100.000,00.
- **Depósito repetido:** cada depósito leva uma chave de idempotência. Clicar duas vezes ou repetir a requisição não credita duas vezes; usar a mesma chave com outro valor é recusado (409).
- **Só licitante tem carteira:** leiloeiro recebe 403 na carteira e não vê o menu "Carteira". Contas novas são sempre de licitante; o leiloeiro de demonstração virá do seed, que **ainda não existe** (planejado para a etapa final).
- **Chave de idempotência só na tela aberta:** ela vive na memória da página. Se o depósito foi creditado mas a resposta se perdeu, repetir o mesmo valor **sem recarregar a página** não credita de novo; recarregar a página antes de tentar outra vez gera uma chave nova e pode creditar duas vezes.
- **Livro-caixa sem edição:** movimentos de dinheiro não podem ser alterados nem apagados, e um usuário com histórico de depósito não pode ser excluído.
- **Cadastro sem confirmação de e-mail:** desligada de propósito para a demonstração; o provedor de e-mail do Supabase hospedado também recusa domínios reservados como `example.com`.
- **Catálogo do The Met:** a busca mostra no máximo 12 resultados e só itens de domínio público com imagem. Itens sem imagem pública não aparecem. Se o catálogo estiver fora, a busca e a criação de lote mostram erro; a vitrine e as páginas de lote continuam funcionando, porque lotes guardam uma cópia do item.
- **Limites conhecidos:** cada busca no catálogo faz até 13 requisições ao The Met (1 busca e até 12 detalhes), sem cache; a vitrine mostra até 60 lotes por lista.
- **Horário:** o leiloeiro informa início e fim no horário de Brasília (UTC-03:00); o servidor guarda em UTC. A contagem de estado (agendado, ao vivo, encerrado) vem do relógio do banco, não do navegador.
- **Editar e cancelar lote:** editar só antes do início e sem lances. Cancelar só sem lances e antes do fim (um lote ao vivo sem lances pode ser cancelado). Lote com lances não pode ser alterado nem cancelado.
- **Logout:** encerra a sessão em todos os dispositivos; o token de acesso já emitido ainda vale no servidor até expirar (até 1 hora).
