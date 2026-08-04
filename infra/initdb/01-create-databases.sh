#!/bin/bash
# Runs once, on first boot of an empty postgres data directory.
# Creates one database per service — services never read each other's tables.
set -euo pipefail

DATABASES="auth jobs resume ai"

for db in $DATABASES; do
  echo "initdb: creating database '$db' owned by '$POSTGRES_USER'"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	SELECT 'CREATE DATABASE "$db"'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec
	GRANT ALL PRIVILEGES ON DATABASE "$db" TO "$POSTGRES_USER";
EOSQL
done

echo "initdb: done — databases: $DATABASES"
