# ─── Nexxore MCP Server — Makefile ────────────────────────
# Quick commands for the Hyperliquid data pipeline + MCP server.
# All targets assume docker compose is available.
# ──────────────────────────────────────────────────────────

COMPOSE := docker compose
DB_USER ?= nexxore
DB_NAME ?= nexxore_mcp
WALLETS ?= wallets.txt

.PHONY: up down logs psql stats backfill migrate build

# ── Core ──────────────────────────────────────────────────

up: ## Start all services (db, ingestion, cohorts, mcp)
	$(COMPOSE) up -d

down: ## Stop all services
	$(COMPOSE) down

build: ## Rebuild images
	$(COMPOSE) build

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

# ── Database ──────────────────────────────────────────────

psql: ## Open psql shell into the TimescaleDB container
	$(COMPOSE) exec timescaledb psql -U $(DB_USER) -d $(DB_NAME)

migrate: ## Run pending SQL migrations
	@for f in storage/migrations/*.sql; do \
		echo "→ Applying $$f"; \
		$(COMPOSE) exec -T timescaledb psql -U $(DB_USER) -d $(DB_NAME) < $$f; \
	done
	@echo "✓ Migrations complete"

stats: ## Print fill count, wallet count, latest fill timestamp
	$(COMPOSE) exec timescaledb psql -U $(DB_USER) -d $(DB_NAME) -c " \
		SELECT \
			(SELECT COUNT(*) FROM trading.fills)                AS total_fills, \
			(SELECT COUNT(DISTINCT wallet) FROM trading.fills)  AS unique_wallets, \
			(SELECT MAX(time) FROM trading.fills)               AS latest_fill, \
			(SELECT COUNT(*) FROM trading.wallet_cohorts)       AS classified_wallets \
	;"

# ── Data Pipeline ─────────────────────────────────────────

backfill: ## Run historical backfill (usage: make backfill WALLETS=wallets.txt)
	$(COMPOSE) run --rm ingestion \
		python -m ingestion.historical_backfill --wallets $(WALLETS)

# ── Help ──────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
