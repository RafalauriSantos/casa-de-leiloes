# Plain `make` runs the full check.
.DEFAULT_GOAL := ci

audit:
	npm audit --omit=dev --audit-level=high

.PHONY: audit install lint typecheck test build ci ci-local dev dev-api dev-web compose db-up db-down db-reset e2e-live seed e2e-prod e2e-browser

install:
	npm ci

lint:
	npx eslint .

typecheck:
	npm run typecheck

build:
	npm run build

# Integration tests need the local Supabase stack (make db-up).
test:
	./scripts/with-local-env.sh sh -c 'start=$$(date -u +%Y-%m-%dT%H:%M:%SZ); npm test; status=$$?; (cd backend && node --import tsx tests/cancel-run-lots.ts "$$start"); exit $$status'

# The only definition of green. GitHub Actions runs exactly this.
ci: lint typecheck build test audit

# The same check as the GitHub job, from a clean state (fresh stack, install and environment): scripts/ci-local.sh.
ci-local:
	./scripts/ci-local.sh

dev:
	$(MAKE) -j2 dev-api dev-web

dev-api:
	./scripts/with-local-env.sh npm run dev -w @casa/backend

e2e-browser:
	./scripts/with-local-env.sh npx playwright test -c e2e/playwright.config.ts

e2e-prod:
	./scripts/with-local-env.sh sh -c 'cd backend && node --import tsx scripts/e2e-deployed.ts'

seed:
	./scripts/with-local-env.sh sh -c 'cd backend && node --import tsx scripts/seed.ts'

dev-web:
	./scripts/with-local-env.sh npm run dev -w @casa/frontend

# B20: the API and the site in Docker Compose, on top of `make db-up`.
compose:
	./scripts/with-local-env.sh docker compose up --build

db-up:
	npx supabase start

db-down:
	npx supabase stop

db-reset:
	npx supabase db reset

# Real Met API, not part of ci: run before each deploy and before submitting.
e2e-live:
	npx tsx backend/scripts/e2e-live.ts
