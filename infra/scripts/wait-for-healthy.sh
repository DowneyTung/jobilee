#!/usr/bin/env bash
# Blocks until every compose service that declares a healthcheck is healthy,
# then prints a summary. Exits non-zero on timeout or a container that died.
set -euo pipefail

TIMEOUT="${TIMEOUT:-120}"
SERVICES=(postgres redis minio auth-service gateway)
deadline=$(( $(date +%s) + TIMEOUT ))

state_of() {
  docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null \
    | awk -v s="$1" '$1 == s { print ($3 == "" ? $2 : $3) }'
}

while :; do
  pending=()
  for svc in "${SERVICES[@]}"; do
    state="$(state_of "$svc")"
    case "$state" in
      healthy) ;;
      exited|dead) echo "✗ $svc is $state"; docker compose logs --tail 40 "$svc"; exit 1 ;;
      *) pending+=("$svc${state:+ ($state)}") ;;
    esac
  done

  (( ${#pending[@]} == 0 )) && break

  if (( $(date +%s) >= deadline )); then
    echo "✗ timed out after ${TIMEOUT}s waiting for: ${pending[*]}"
    docker compose ps
    exit 1
  fi

  printf '\rwaiting for: %-60s' "${pending[*]}"
  sleep 2
done

printf '\r%-72s\r' ''
for svc in "${SERVICES[@]}"; do echo "✓ $svc healthy"; done
echo
echo "  web       http://localhost:${WEB_PORT:-5173}"
echo "  gateway   http://localhost:${GATEWAY_PORT:-8080}  (/health, /ready)"
echo "  postgres  localhost:${POSTGRES_PORT:-5432}  (databases: auth jobs resume ai)"
echo "  redis     localhost:${REDIS_PORT:-6379}"
echo "  minio     localhost:${MINIO_PORT:-9000}  console http://localhost:${MINIO_CONSOLE_PORT:-9001}"
