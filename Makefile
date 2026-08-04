.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose
# Test stack: prod image targets + a mock Anthropic API, no dev overrides.
COMPOSE_TEST := docker compose -f docker-compose.yml -f docker-compose.test.yml

.PHONY: help env up up-d down reset migrate rebuild logs ps psql redis-cli health install build typecheck test test-stack test-stack-down test-integration test-e2e test-all clean

help: ## show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

env: ## create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "created .env from .env.example — add your ANTHROPIC_API_KEY")

up: env ## start everything with hot reload (foreground)
	$(COMPOSE) up --build

up-d: env ## same, detached
	$(COMPOSE) up --build -d

down: ## stop containers
	$(COMPOSE) down

reset: ## nuke volumes (fresh DB / object store)
	$(COMPOSE) down -v

migrate: ## apply prisma migrations for every service
	$(COMPOSE) exec -w /app/services/auth-service auth-service npx prisma migrate deploy
	$(COMPOSE) exec -w /app/services/jobs-service jobs-service npx prisma migrate deploy
	$(COMPOSE) exec -w /app/services/resume-service resume-service npx prisma migrate deploy
	$(COMPOSE) exec -w /app/services/ai-service ai-service npx prisma migrate deploy

rebuild: ## rebuild images and drop the node_modules volumes (after adding a dependency)
	$(COMPOSE) down
	@docker volume ls -q --filter name=$$(basename $$PWD) | grep node_modules | xargs -r docker volume rm
	$(COMPOSE) up --build -d

logs: ## tail logs (make logs s=postgres for one service)
	$(COMPOSE) logs -f $(s)

ps: ## show container status + health
	$(COMPOSE) ps

health: ## wait until infra healthchecks pass, then report
	@./infra/scripts/wait-for-healthy.sh

psql: ## open a psql shell (make psql db=jobs)
	$(COMPOSE) exec postgres psql -U $${POSTGRES_USER:-jobilee} -d $(or $(db),jobilee)

redis-cli: ## open a redis shell
	$(COMPOSE) exec redis redis-cli

install: ## install workspace dependencies
	corepack enable && pnpm install

build: ## build all packages/services
	pnpm turbo run build

typecheck: ## typecheck the whole workspace
	pnpm turbo run typecheck

test: ## run unit tests (fast, no services needed)
	pnpm turbo run test --filter='./packages/*' --filter='./services/*'

test-stack: env ## start the stack with a mocked Anthropic API
	$(COMPOSE_TEST) up --build -d
	@./infra/scripts/wait-for-healthy.sh
	@$(COMPOSE_TEST) exec -w /app/services/auth-service auth-service npx prisma migrate deploy 2>/dev/null | tail -1
	@$(COMPOSE_TEST) exec -w /app/services/jobs-service jobs-service npx prisma migrate deploy 2>/dev/null | tail -1
	@$(COMPOSE_TEST) exec -w /app/services/resume-service resume-service npx prisma migrate deploy 2>/dev/null | tail -1
	@$(COMPOSE_TEST) exec -w /app/services/ai-service ai-service npx prisma migrate deploy 2>/dev/null | tail -1

test-stack-down: ## stop the test stack
	$(COMPOSE_TEST) down

test-integration: ## run integration tests (needs: make test-stack)
	pnpm turbo run build --filter='./packages/*'
	pnpm --filter @jobilee/integration-tests test

test-e2e: ## run browser end-to-end tests (needs: make test-stack)
	pnpm --filter @jobilee/e2e-tests test

test-all: ## unit + integration + e2e, starting and stopping the stack
	$(MAKE) test
	$(MAKE) test-stack
	$(MAKE) test-integration
	$(MAKE) test-e2e
	$(MAKE) test-stack-down

clean: ## remove build output and node_modules
	pnpm turbo run clean 2>/dev/null || true
	rm -rf node_modules .turbo
