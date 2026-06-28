# =============================================================================
# GuanWo (观我) - Makefile for Docker Deployment
# =============================================================================
# Common commands for building, deploying, and managing the application.
#
# Usage:
#   make deploy    - Full deployment (build + migrate + static + up)
#   make up        - Start all services
#   make down      - Stop all services
#   make logs      - View logs
# =============================================================================

# =============================================================================
# Configuration
# =============================================================================

COMPOSE_BASE := docker/docker-compose.yml
COMPOSE_OVERRIDE := docker/docker-compose.override.yml
COMPOSE_PROD := docker compose -f $(COMPOSE_BASE)
COMPOSE_DEV := docker compose -f $(COMPOSE_BASE) -f $(COMPOSE_OVERRIDE)

PROJECT_NAME := guanwo
DOCKER_DIR := docker

BLUE := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
RESET := \033[0m

# =============================================================================
# Default Target
# =============================================================================

.PHONY: help
help: ## Show this help message
	@echo "$(GREEN)观我 (GuanWo) - Docker Deployment Commands$(RESET)"
	@echo "========================================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-15s$(RESET) %s\n", $$1, $$2}'

# =============================================================================
# Build Commands
# =============================================================================

.PHONY: build
build: ## Build production containers
	@echo "$(GREEN)Building production containers...$(RESET)"
	$(COMPOSE_PROD) build

.PHONY: build-dev
build-dev: ## Build containers for development
	@echo "$(GREEN)Building development containers...$(RESET)"
	$(COMPOSE_DEV) build

.PHONY: pull
pull: ## Pull latest base images
	@echo "$(GREEN)Pulling latest images...$(RESET)"
	$(COMPOSE_PROD) pull

# =============================================================================
# Start / Stop Commands
# =============================================================================

.PHONY: up
up: ## Start all services in detached mode (production)
	@echo "$(GREEN)Starting production services...$(RESET)"
	$(COMPOSE_PROD) up -d
	@echo "$(GREEN)Services started!$(RESET)"
	@echo "  - App:     http://localhost (via nginx)"
	@echo "  - Health:  http://localhost/api/health/"

.PHONY: up-dev
up-dev: ## Start services in development mode with hot reload
	@echo "$(GREEN)Starting development services...$(RESET)"
	$(COMPOSE_DEV) up -d
	@echo "$(GREEN)Dev services started!$(RESET)"
	@echo "  - App:     http://localhost:8080 (via nginx)"
	@echo "  - Django:  http://localhost:8000 (direct access)"
	@echo "  - DB:      localhost:5432 (PostgreSQL)"
	@echo "  - Redis:   localhost:6379"

.PHONY: down
down: ## Stop all services
	@echo "$(YELLOW)Stopping all services...$(RESET)"
	$(COMPOSE_PROD) down

.PHONY: down-dev
down-dev: ## Stop development services
	@echo "$(YELLOW)Stopping development services...$(RESET)"
	$(COMPOSE_DEV) down

.PHONY: restart
restart: down up ## Restart all services

.PHONY: restart-django
restart-django: ## Restart only the Django service
	@echo "$(YELLOW)Restarting Django...$(RESET)"
	$(COMPOSE_PROD) restart django

# =============================================================================
# Log Commands
# =============================================================================

.PHONY: logs
logs: ## View logs from all services
	$(COMPOSE_PROD) logs -f --tail=100

.PHONY: logs-django
logs-django: ## View Django logs only
	$(COMPOSE_PROD) logs -f --tail=100 django

.PHONY: logs-nginx
logs-nginx: ## View Nginx logs only
	$(COMPOSE_PROD) logs -f --tail=100 nginx

.PHONY: logs-postgres
logs-postgres: ## View PostgreSQL logs only
	$(COMPOSE_PROD) logs -f --tail=100 postgres

.PHONY: logs-redis
logs-redis: ## View Redis logs only
	$(COMPOSE_PROD) logs -f --tail=100 redis

# =============================================================================
# Django Management Commands
# =============================================================================

.PHONY: migrate
migrate: ## Run Django migrations
	@echo "$(GREEN)Running Django migrations...$(RESET)"
	$(COMPOSE_PROD) exec django python manage.py migrate --noinput

.PHONY: static
static: ## Run Django collectstatic
	@echo "$(GREEN)Collecting static files...$(RESET)"
	$(COMPOSE_PROD) exec django python manage.py collectstatic --noinput --clear

.PHONY: shell
shell: ## Open Django management shell
	$(COMPOSE_PROD) exec django python manage.py shell

.PHONY: dbshell
dbshell: ## Open PostgreSQL shell
	$(COMPOSE_PROD) exec postgres psql -U $(POSTGRES_USER:-guanwo) -d $(POSTGRES_DB:-guanwo)

.PHONY: createsuperuser
createsuperuser: ## Create Django superuser
	$(COMPOSE_PROD) exec django python manage.py createsuperuser

# =============================================================================
# Database Backup & Restore
# =============================================================================

.PHONY: backup
backup: ## Create a database backup
	@echo "$(GREEN)Creating database backup...$(RESET)"
	@mkdir -p backups
	$(COMPOSE_PROD) exec -T postgres \
		pg_dump -U $(POSTGRES_USER:-guanwo) -d $(POSTGRES_DB:-guanwo) \
		| gzip > backups/guanwo_$$(date +%Y%m%d_%H%M%S).sql.gz
	@echo "$(GREEN)Backup saved to backups/$(RESET)"

.PHONY: restore
restore: ## Restore database from backup (usage: make restore FILE=backups/guanwo_20260115.sql.gz)
	@if [ -z "$(FILE)" ]; then \
		echo "$(RED)Error: Specify backup file with FILE=...$(RESET)"; \
		echo "  Available backups:"; \
		ls -1 backups/*.sql.gz 2>/dev/null || echo "  (none)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Restoring from $(FILE)...$(RESET)"
	@read -p "This will overwrite the current database. Are you sure? [y/N] " confirm && [ $$confirm = y ] || exit 1
	gunzip < $(FILE) | $(COMPOSE_PROD) exec -T postgres \
		psql -U $(POSTGRES_USER:-guanwo) -d $(POSTGRES_DB:-guanwo)
	@echo "$(GREEN)Restore complete!$(RESET)"

# =============================================================================
# SSL / HTTPS Certificate Management
# =============================================================================

.PHONY: ssl
ssl: ## Initialize Let's Encrypt SSL certificates (first-time setup)
	@echo "$(GREEN)Requesting SSL certificates...$(RESET)"
	@echo "$(YELLOW)Make sure DOMAIN_NAME and CERTBOT_EMAIL are set in docker/.env.production!$(RESET)"
	bash $(DOCKER_DIR)/scripts/init-letsencrypt.sh

.PHONY: ssl-renew
ssl-renew: ## Manually trigger SSL certificate renewal
	@echo "$(GREEN)Renewing SSL certificates...$(RESET)"
	bash $(DOCKER_DIR)/scripts/certbot-renew.sh

# =============================================================================
# Health & Status
# =============================================================================

.PHONY: health
health: ## Check health of all services
	@echo "$(GREEN)Checking service health...$(RESET)"
	@$(COMPOSE_PROD) ps
	@echo ""
	@echo "$(BLUE)Health endpoint:$(RESET)"
	@curl -s http://localhost/api/health/ 2>/dev/null || echo "  $(RED)Not reachable$(RESET)"

.PHONY: status
status: ## Show container status and resource usage
	@$(COMPOSE_PROD) ps
	@echo ""
	@echo "$(BLUE)Resource usage:$(RESET)"
	@docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.PIDs}}" \
		$$($(COMPOSE_PROD) ps -q) 2>/dev/null || true

.PHONY: ps
ps: ## List running containers
	@$(COMPOSE_PROD) ps

# =============================================================================
# Cleanup Commands
# =============================================================================

.PHONY: clean
clean: ## Stop containers, remove volumes and rebuild everything (WARNING: data loss!)
	@echo "$(RED)WARNING: This will destroy all data!$(RESET)"
	@read -p "Are you sure? [y/N] " confirm && [ $$confirm = y ] || exit 1
	$(COMPOSE_PROD) down -v --remove-orphans
	@echo "$(GREEN)Cleanup complete. Run 'make deploy' to start fresh.$(RESET)"

.PHONY: prune
prune: ## Remove unused Docker images and volumes (system-wide)
	@echo "$(YELLOW)Pruning unused Docker resources...$(RESET)"
	docker system prune -af --volumes

# =============================================================================
# Full Deployment
# =============================================================================

.PHONY: deploy
deploy: ## Full deployment via the deploy script
	@echo "$(GREEN)Starting full deployment...$(RESET)"
	bash $(DOCKER_DIR)/scripts/deploy.sh
