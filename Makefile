# Plain `make` runs the full check.
.DEFAULT_GOAL := ci

audit:
	npm audit --omit=dev --audit-level=high

.PHONY: audit install lint typecheck test build ci dev dev-api dev-web db-up db-down db-reset e2e-live seed

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

dev:
	$(MAKE) -j2 dev-api dev-web

dev-api:
	./scripts/with-local-env.sh npm run dev -w @casa/backend

seed:
	./scripts/with-local-env.sh sh -c 'cd backend && node --import tsx scripts/seed.ts'

dev-web:
	./scripts/with-local-env.sh npm run dev -w @casa/frontend

db-up:
	npx supabase start

db-down:
	npx supabase stop

db-reset:
	npx supabase db reset

# Real Met API, not part of ci: run before each deploy and before submitting.
e2e-live:
	npx tsx backend/scripts/e2e-live.ts
