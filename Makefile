.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help env up up-d down reset migrate rebuild logs ps psql redis-cli health install build typecheck test clean

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

test: ## run all tests
	pnpm turbo run test

clean: ## remove build output and node_modules
	pnpm turbo run clean 2>/dev/null || true
	rm -rf node_modules .turbo
