#!/usr/bin/env bash
# Live smoke test for the job pipeline against a running dev server.
# Requires: `npm run dev` already running, and a reachable Redis + OpenRouter key
# (see .env.local). Uses the empty-query manifesto path so it never depends on
# the RAG knowledge base.
#
# Flow under test:
#   1. POST /job/query with an empty query        -> mints a NEW job_id,
#      generates + stores the script. Does NOT touch the left panel.
#   2. POST /job/query again with that SAME job_id -> returns the identical
#      job_id and already-generated script (a lookup, not a new generation).
#      Still does NOT touch the left panel.
#   3. POST /job/queue/<job_id>                    -> this is the ONLY call
#      that broadcasts over SSE and updates the left panel, forced:true.
#
# Usage: BASE_URL=http://localhost:3000 ./scripts/test-job-flow.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
SSE_LOG="$(mktemp)"
PASS=0

cleanup() {
  [[ -n "${SSE_PID:-}" ]] && kill "$SSE_PID" 2>/dev/null || true
  rm -f "$SSE_LOG"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  exit 1
}

echo "==> Checking $BASE_URL is reachable"
curl -sf -o /dev/null "$BASE_URL/job/qa-recent" || fail "server not reachable at $BASE_URL"

echo "==> Step 0: open SSE listener on /job/events"
curl -sN "$BASE_URL/job/events" > "$SSE_LOG" 2>&1 &
SSE_PID=$!
sleep 1
grep -q '"connected":true' "$SSE_LOG" || fail "SSE did not send initial connection confirmation"
echo "    connected"

echo "==> Step 1: POST /job/query with empty query (mints a new job_id)"
QUERY_RESPONSE="$(curl -sf -X POST "$BASE_URL/job/query" \
  -H "Content-Type: application/json" \
  -d '{"query":"","user_id":"smoke-test"}')"

JOB_ID="$(echo "$QUERY_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['jobs'][0]['job_id'])")"
SCRIPT="$(echo "$QUERY_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['jobs'][0]['script'])")"

[[ -n "$JOB_ID" ]] || fail "no job_id in /job/query response"
[[ -n "$SCRIPT" ]] || fail "no script in /job/query response"
echo "    job_id: $JOB_ID"
echo "    script: ${SCRIPT:0:60}..."
PASS=$((PASS+1))

echo "==> Step 2: confirm /job/query did NOT broadcast to the left panel"
sleep 1
grep -q "\"job_id\":\"$JOB_ID\"" "$SSE_LOG" && fail "SSE unexpectedly broadcast job_id $JOB_ID after /job/query — it should stay silent"
echo "    SSE stayed silent, as expected"
PASS=$((PASS+1))

echo "==> Step 3: POST /job/query AGAIN with that same job_id — should return the cached script unchanged"
LOOKUP_RESPONSE="$(curl -sf -X POST "$BASE_URL/job/query" \
  -H "Content-Type: application/json" \
  -d "{\"job_id\":\"$JOB_ID\"}")"

LOOKUP_JOB_ID="$(echo "$LOOKUP_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['jobs'][0]['job_id'])")"
LOOKUP_SCRIPT="$(echo "$LOOKUP_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)['jobs'][0]['script'])")"

[[ "$LOOKUP_JOB_ID" == "$JOB_ID" ]] || fail "expected same job_id on lookup, got $LOOKUP_JOB_ID"
[[ "$LOOKUP_SCRIPT" == "$SCRIPT" ]] || fail "expected identical script on lookup, got a different script"
echo "    same job_id, same script — no regeneration"
PASS=$((PASS+1))

echo "==> Step 4: confirm the lookup call also did NOT broadcast to the left panel"
sleep 1
grep -q "\"job_id\":\"$JOB_ID\"" "$SSE_LOG" && fail "SSE unexpectedly broadcast job_id $JOB_ID after the lookup call"
echo "    SSE still silent, as expected"
PASS=$((PASS+1))

echo "==> Step 5: POST /job/queue/$JOB_ID — this is what should trigger the left panel"
QUEUE_STATUS="$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/job/queue/$JOB_ID")"
[[ "$QUEUE_STATUS" == "200" ]] || fail "expected 200 from /job/queue/$JOB_ID, got $QUEUE_STATUS"
echo "    200 OK"
PASS=$((PASS+1))

echo "==> Step 6: confirm exactly one forced SSE event now fired for this job_id"
sleep 1
COUNT="$(grep -c "\"job_id\":\"$JOB_ID\"" "$SSE_LOG")"
[[ "$COUNT" -eq 1 ]] || fail "expected exactly 1 SSE event for $JOB_ID after /job/queue, got $COUNT"
grep "\"job_id\":\"$JOB_ID\"" "$SSE_LOG" | grep -q '"forced":true' || fail "SSE event was not forced:true"
grep -qF "$SCRIPT" "$SSE_LOG" || fail "SSE payload script does not match the original /job/query response script"
echo "    forced:true, script matches"
PASS=$((PASS+1))

echo
echo "PASS: all $PASS steps ok — job_id $JOB_ID stayed identical through query -> lookup -> queue, and only /job/queue triggered the left panel"
