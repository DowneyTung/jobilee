#!/usr/bin/env bash
# Proves a freshly booted stack actually works, not merely that its containers
# report healthy. Run after `make up && make migrate`.
set -euo pipefail

GATEWAY="${GATEWAY_URL:-http://localhost:8080}"
WEB="${WEB_URL:-http://localhost:5173}"
EMAIL="smoke+$(date +%s)-$RANDOM@example.test"
PASSWORD="smoke-test-password"

fail() {
  echo "✗ $1" >&2
  exit 1
}

json() {
  node -e '
    const path = process.argv[1];
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      const value = path.split(".").reduce((a, k) => a?.[k], JSON.parse(raw));
      process.stdout.write(value === undefined || value === null ? "" : String(value));
    });
  ' "$1"
}

echo "→ gateway readiness"
curl -fsS "$GATEWAY/ready" | grep -q '"status":"ok"' || fail "gateway not ready"

echo "→ web is served"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB")" = "200" ] || fail "web not serving"

echo "→ register"
TOKEN=$(curl -fsS -X POST "$GATEWAY/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | json accessToken)
[ -n "$TOKEN" ] || fail "no access token returned"

echo "→ protected route rejects an anonymous caller"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/api/jobs")" = "401" ] || fail "protected route was open"

echo "→ create a job"
JOB=$(curl -fsS -X POST "$GATEWAY/api/jobs" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"company":"Smoke Co","title":"Engineer","jd":"Ship things."}' | json id)
[ -n "$JOB" ] || fail "job was not created"

echo "→ move a stage and record history"
curl -fsS -o /dev/null -X POST "$GATEWAY/api/jobs/$JOB/stage" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"stage":"APPLIED"}'
EVENTS=$(curl -fsS "$GATEWAY/api/jobs/$JOB" -H "authorization: Bearer $TOKEN" | json events.length)
[ "$EVENTS" = "2" ] || fail "expected 2 history entries, got '$EVENTS'"

echo "→ base resume round-trips"
curl -fsS -o /dev/null -X PUT "$GATEWAY/api/resume/base" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"content":"# Smoke Test"}'
CONTENT=$(curl -fsS "$GATEWAY/api/resume/base" -H "authorization: Bearer $TOKEN" | json content)
[ "$CONTENT" = "# Smoke Test" ] || fail "base resume did not persist"

echo "→ object storage accepts an upload"
PDF=$(mktemp "${TMPDIR:-/tmp}/smoke-XXXXXX.pdf")
printf '%%PDF-1.4\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > "$PDF"
FILE_ID=$(curl -fsS -X POST "$GATEWAY/api/resume/files" \
  -H "authorization: Bearer $TOKEN" -F "file=@$PDF;type=application/pdf" | json id)
rm -f "$PDF"
[ -n "$FILE_ID" ] || fail "upload failed"

echo "→ signed download URL is issued"
URL=$(curl -fsS "$GATEWAY/api/resume/files/$FILE_ID" -H "authorization: Bearer $TOKEN" | json url)
case "$URL" in
  http*) ;;
  *) fail "no signed URL returned" ;;
esac

echo "→ ai-service accepts and queues a task"
TASK=$(curl -fsS -X POST "$GATEWAY/api/ai/tasks" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"type\":\"RESEARCH\",\"input\":{\"jobId\":\"$JOB\",\"company\":\"Smoke Co\",\"title\":\"Engineer\"}}" | json status)
# Without a real key the generation fails, but queueing must still work — that
# is the part the boot is responsible for.
[ "$TASK" = "QUEUED" ] || fail "task was not queued (got '$TASK')"

echo "→ metrics are exposed"
curl -fsS "$GATEWAY/metrics" | grep -q "jobilee_gateway_requests_total" || fail "no metrics"

echo
echo "✓ smoke test passed against a freshly booted stack"
