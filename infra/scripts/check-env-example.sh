#!/usr/bin/env bash
# `.env.example` is the only documentation of what the stack needs. A variable
# referenced in compose but missing from the template means `make up` works for
# whoever added it and fails for the next person who clones.
set -euo pipefail

missing=0

# Every ${VAR} compose interpolates, minus those with a :- default.
referenced=$(grep -ohE '\$\{[A-Z_][A-Z0-9_]*' docker-compose.yml docker-compose.override.yml \
  | sed 's/\${//' | sort -u)

for var in $referenced; do
  # A default makes the variable optional.
  if grep -qE "\\\$\{${var}:-" docker-compose.yml docker-compose.override.yml; then
    continue
  fi
  if ! grep -qE "^${var}=" .env.example; then
    echo "✗ ${var} is required by compose but absent from .env.example"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  echo
  echo "Add the missing variables to .env.example so a fresh clone can boot."
  exit 1
fi

echo "✓ .env.example covers every variable compose requires"
