audit:
	npm audit --omit=dev --audit-level=high

.PHONY: audit install lint typecheck test build ci dev dev-api dev-web db-up db-down db-reset

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
	./scripts/with-local-env.sh npm test

# The only definition of green. GitHub Actions runs exactly this.
ci: lint typecheck build test audit

dev:
	$(MAKE) -j2 dev-api dev-web

dev-api:
	./scripts/with-local-env.sh npm run dev -w @casa/backend

dev-web:
	./scripts/with-local-env.sh npm run dev -w @casa/frontend

db-up:
	npx supabase start

db-down:
	npx supabase stop

db-reset:
	npx supabase db reset
