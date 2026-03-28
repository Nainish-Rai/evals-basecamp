#!/usr/bin/env bash
set -euo pipefail

API_KEY="$(awk -F= '/^WORKSPACE_AGENT_API_KEYS=/{print $2}' /Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/agent-executor-secrets.env | tr -d '\r\n')"
BASE_URL="http://npa-evals-agent-1097588215.ap-south-1.elb.amazonaws.com"
PAYLOAD_FILE="/tmp/npa-evals-smoke.json"
RESPONSE_HEADERS="/tmp/npa-evals-response-headers.txt"
RESPONSE_BODY="/tmp/npa-evals-response-body.txt"

cat >"$PAYLOAD_FILE" <<'JSON'
{
  "scenario": {
    "scenarioId": "scenario-risk-001-smoke",
    "title": "Residual risk smoke test",
    "agentFamily": "workspace",
    "taskFamily": "risk",
    "difficulty": "medium",
    "modalityProfile": ["text"],
    "caseBrief": "Read the workspace note and answer what residual risk should remain and why.",
    "availableTools": ["workspace_write", "risk_lookup"],
    "expectedOutcomes": [
      {
        "findingId": "finding-risk-001",
        "summary": "Residual risk remains high due to incomplete vendor access remediation.",
        "severity": "high",
        "requiredEvidenceRefs": ["artifact-risk-note"],
        "requiredPolicyRefs": ["risk.section.4"]
      }
    ]
  },
  "execution": {
    "mode": "initial",
    "runId": "smoke-risk-001",
    "feedbackTurns": []
  },
  "environment": {
    "workspaceRoot": "workspace/case",
    "artifactSnapshots": [
      {
        "entryId": "artifact-risk-note",
        "sourceKind": "scenario_artifact",
        "sourceId": "artifact-risk-note",
        "title": "Risk note",
        "description": "Synthetic smoke-test note",
        "relativePath": "workspace/case/risk-note.md",
        "content": "Residual risk is still HIGH because vendor access remediation is incomplete. Do not lower the rating until remediation closes.",
        "contentType": "text/markdown"
      }
    ],
    "surfacedContext": {
      "contextScenarioType": "minimal_sufficient_context",
      "requiredContext": [
        "vendor access remediation incomplete",
        "residual risk high"
      ]
    },
    "surfacedDrift": {
      "expectedOutcomeCriteria": {
        "correctnessExpectation": "Keep residual risk high and tie it to incomplete vendor access remediation.",
        "requiredFindings": ["finding-risk-001"],
        "requiredEvidenceRefs": ["artifact-risk-note"],
        "expectedDisposition": "maintain_high_residual_risk"
      }
    },
    "surfacedMemory": null
  },
  "traceContext": {
    "traceId": "curl-smoke-001",
    "enabled": false
  }
}
JSON

echo "Auth check against $BASE_URL/api/v1"
curl -i "$BASE_URL/api/v1" \
  -H "X-API-Key: $API_KEY"

echo
echo "Eval smoke test against $BASE_URL/api/v1/evals/run?run_id=smoke-risk-001"
curl -sS \
  -D "$RESPONSE_HEADERS" \
  -o "$RESPONSE_BODY" \
  "$BASE_URL/api/v1/evals/run?run_id=smoke-risk-001" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  --data @"$PAYLOAD_FILE"

echo "Response headers:"
sed -n '1,20p' "$RESPONSE_HEADERS"

echo "Response body:"
if jq . <"$RESPONSE_BODY" >/dev/null 2>&1; then
  jq . <"$RESPONSE_BODY"
else
  cat "$RESPONSE_BODY"
fi
