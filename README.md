# Casa de Leilões

Casa de leilões online (teste técnico Verzel "Elite Dev"). Em construção: este README é completado na entrega.

## Rodar localmente

Requisitos: Node 22, Docker, make.

```bash
npm ci
make db-up      # Supabase local (Postgres e Auth reais)
make dev        # API em :8787 e site em :5173
make ci         # lint, tipos, build e testes (a única definição de verde)
```

As decisões de design e seus tradeoffs estão em [docs/DECISIONS.md](docs/DECISIONS.md).

## Produção (Vercel + Supabase)

- Site e API no mesmo projeto Vercel (Vercel Services: `frontend/` e `backend/`, rota `/api/*` para o back).
- Variáveis (Vercel, ambiente Production): `DATABASE_URL` (pooler de transação, porta 6543, com `?sslmode=require`), `SUPABASE_URL`, `AUDIT_HMAC_SECRET`, `CRON_SECRET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Modelo em `.env.example`.
- No Supabase: aplicar `supabase/migrations`, desligar "Confirm email" (Auth > Sign In / Providers) e manter as chaves de assinatura assimétricas.
- Encerramento agendado (a cada minuto): `DATABASE_URL=... CRON_SECRET=... APP_URL=https://<dominio> npx tsx backend/scripts/schedule-close-due.ts`. Guarda URL e segredo no Vault do Supabase.
