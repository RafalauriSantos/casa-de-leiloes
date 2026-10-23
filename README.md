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
