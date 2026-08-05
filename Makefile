.PHONY: up down logs migrate seed dev help

help:
	@echo "Targets:"
	@echo "  make up       - Start local data plane (Docker Compose)"
	@echo "  make down     - Stop Compose stack"
	@echo "  make logs     - Tail Compose logs"
	@echo "  make migrate  - Run Drizzle migrations"
	@echo "  make seed     - Seed admin org/user"
	@echo "  make dev      - Run API + worker + web via Turborepo"

up:
	docker compose -f infra/docker-compose.yml --env-file .env up -d

down:
	docker compose -f infra/docker-compose.yml down

logs:
	docker compose -f infra/docker-compose.yml logs -f

migrate:
	pnpm db:migrate

seed:
	pnpm db:seed

dev:
	pnpm dev
