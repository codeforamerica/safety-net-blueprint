#!/usr/bin/env bash
# Scenario: Application Submission — SNAP + Medicaid
#
# Sets up a three-member household applying for SNAP and Medicaid.
# Can be run against the local mock server or a real system.
# Exercises the income inconclusive path (document fallback) and
# mixed person-matching outcomes.
#
# Usage:
#   ./application-submission.setup.sh [base-url]
#   ./application-submission.setup.sh http://localhost:1080
#
# Requires: curl, node

set -euo pipefail
BASE_URL="${1:-http://localhost:1080}"
json() { node -e "let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>console.log(JSON.parse(d)$1))"; }

echo "── Pre-submission ────────────────────────────────────────────────────────"

# Create application
APP=$(curl -s -X POST "$BASE_URL/intake/applications" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"programs":["snap","medicaid"],"channel":"online"}')
APP_ID=$(echo "$APP" | json '.id')
echo "Created application: $APP_ID"

# Add member A — SNAP + Medicaid (person match: confirmed)
MEMBER_A=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/members" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"programs":["snap","medicaid"]}')
MEMBER_A_ID=$(echo "$MEMBER_A" | json '.id')
echo "Created member A: $MEMBER_A_ID"

# Add member B — SNAP only (person match: no_match)
MEMBER_B=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/members" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"programs":["snap"]}')
MEMBER_B_ID=$(echo "$MEMBER_B" | json '.id')
echo "Created member B: $MEMBER_B_ID"

# Add member C — Medicaid only (person match: review_required)
MEMBER_C=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/members" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"programs":["medicaid"]}')
MEMBER_C_ID=$(echo "$MEMBER_C" | json '.id')
echo "Created member C: $MEMBER_C_ID"

# Add income for member A
INCOME_A=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/members/$MEMBER_A_ID/incomes" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"type":"employment","monthlyAmount":1200}')
INCOME_A_ID=$(echo "$INCOME_A" | json '.id')
echo "Added income for member A: $INCOME_A_ID"

# Add income for member B
INCOME_B=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/members/$MEMBER_B_ID/incomes" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"type":"employment","monthlyAmount":800}')
INCOME_B_ID=$(echo "$INCOME_B" | json '.id')
echo "Added income for member B: $INCOME_B_ID"

# Add income for member C
INCOME_C=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/members/$MEMBER_C_ID/incomes" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant" \
  -d '{"type":"employment","monthlyAmount":600}')
INCOME_C_ID=$(echo "$INCOME_C" | json '.id')
echo "Added income for member C: $INCOME_C_ID"

echo ""
echo "── Stubs ─────────────────────────────────────────────────────────────────"

# Income verification: ssa_ievs returns inconclusive — exercises document fallback path
STUB_1=$(curl -s -X POST "$BASE_URL/mock/stubs/events" \
  -H "Content-Type: application/json" \
  -d '{"on":"data_exchange.service_call.created","match":{"data.serviceType":"ssa_ievs"},"respond":{"type":"data_exchange.call.completed","data":{"result":"inconclusive"}}}')
echo "Stub: ssa_ievs → inconclusive"

# MAGI Medicaid: fdsh_fti returns conclusive
STUB_2=$(curl -s -X POST "$BASE_URL/mock/stubs/events" \
  -H "Content-Type: application/json" \
  -d '{"on":"data_exchange.service_call.created","match":{"data.serviceType":"fdsh_fti"},"respond":{"type":"data_exchange.call.completed","data":{"result":"conclusive"}}}')
echo "Stub: fdsh_fti → conclusive"

# MAGI Medicaid: fdsh_medicare_vci returns conclusive
STUB_3=$(curl -s -X POST "$BASE_URL/mock/stubs/events" \
  -H "Content-Type: application/json" \
  -d '{"on":"data_exchange.service_call.created","match":{"data.serviceType":"fdsh_medicare_vci"},"respond":{"type":"data_exchange.call.completed","data":{"result":"conclusive"}}}')
echo "Stub: fdsh_medicare_vci → conclusive"

echo ""
echo "── Submit ────────────────────────────────────────────────────────────────"

# Submit application — starts the regulatory clock and triggers automated processing
SUBMIT=$(curl -s -X POST "$BASE_URL/intake/applications/$APP_ID/submit" \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: applicant-1" \
  -H "X-Caller-Roles: applicant")
echo "Application submitted: $(echo "$SUBMIT" | json '.status')"

echo ""
echo "── Person matching ───────────────────────────────────────────────────────"

# Client Management resolves person matches asynchronously after submission

# Member A — confirmed match
MATCH_A=$(curl -s -X POST "$BASE_URL/platform/events" \
  -H "Content-Type: application/json" \
  -d "{\"specversion\":\"1.0\",\"type\":\"client_management.person.match_resolved\",\"source\":\"/test\",\"subject\":\"$MEMBER_A_ID\",\"data\":{\"memberId\":\"$MEMBER_A_ID\",\"matchType\":\"confirmed\",\"candidates\":[{\"personId\":\"aaaaaaaa-0001-0001-0001-000000000001\",\"confidenceScore\":0.99}]}}")
echo "Person match resolved: member A (confirmed)"

# Member B — no match found
MATCH_B=$(curl -s -X POST "$BASE_URL/platform/events" \
  -H "Content-Type: application/json" \
  -d "{\"specversion\":\"1.0\",\"type\":\"client_management.person.match_resolved\",\"source\":\"/test\",\"subject\":\"$MEMBER_B_ID\",\"data\":{\"memberId\":\"$MEMBER_B_ID\",\"matchType\":\"no_match\",\"candidates\":[]}}")
echo "Person match resolved: member B (no_match)"

# Member C — multiple candidates, requires review
MATCH_C=$(curl -s -X POST "$BASE_URL/platform/events" \
  -H "Content-Type: application/json" \
  -d "{\"specversion\":\"1.0\",\"type\":\"client_management.person.match_resolved\",\"source\":\"/test\",\"subject\":\"$MEMBER_C_ID\",\"data\":{\"memberId\":\"$MEMBER_C_ID\",\"matchType\":\"review_required\",\"candidates\":[{\"personId\":\"cccccccc-0001-0001-0001-000000000001\",\"confidenceScore\":0.82}]}}")
echo "Person match resolved: member C (review_required)"

echo ""
echo "── Done ──────────────────────────────────────────────────────────────────"
echo "Application ID: $APP_ID"
echo "Member A:       $MEMBER_A_ID"
echo "Member B:       $MEMBER_B_ID"
echo "Member C:       $MEMBER_C_ID"
