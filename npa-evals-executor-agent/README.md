# NPA Evals Executor Agent

This service exposes the workspace agent over HTTP so the eval harness in `/Users/aviral/Projects/Onfi/evals-basecamp` can run scenarios against a real agent.

The eval endpoint is available at:

- `/evals/run`
- `/api/v1/evals/run`

Use `/evals/run` for `evals-basecamp` runs. Use `/api/v1/evals/run` for manual smoke checks.

## Prerequisites

- Docker with `docker compose`
- Node.js 20+
- `pnpm`
- `curl`
- `jq`
- a reachable OpenAI-compatible model endpoint

## Setup

1. Go to the agent folder:

```sh
cd npa-evals-executor-agent
```

2. Update `.env` with valid values:

```sh
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
AGENT_ARTIFACTS_BUCKET=...
AGENT_TRACE_BUCKET=...
OPENAI_BASE_URL=...
OPENAI_API_KEY=...
WORKSPACE_AGENT_MODEL=...
COMPLIANCE_SUBAGENT_MODEL=...
WORKSPACE_AGENT_REQUEST_TIMEOUT=600
```

3. If you want auth enabled locally, also add:

```sh
WORKSPACE_AGENT_API_KEYS=local-dev-key
```

If `WORKSPACE_AGENT_API_KEYS` is not set, the API runs without auth.

4. Create the local bind-mount directories used by compose:

```sh
mkdir -p IIFL-artifacts
mkdir -p traces
```

## Run Locally

From `npa-evals-executor-agent/`:

```sh
docker compose up --build
```

This starts:

- the agent executor on `http://localhost:8010`
- MinIO on `http://localhost:9000`
- MinIO console on `http://localhost:9001`

Quick checks:

```sh
curl http://localhost:8010/api/v1/healthz
curl http://localhost:8010/api/v1/readyz
curl http://localhost:8010/docs
```

If auth is enabled:

```sh
curl http://localhost:8010/api/v1 \
  -H 'X-API-Key: local-dev-key'
```

If auth is disabled:

```sh
curl http://localhost:8010/api/v1
```

## Smoke Test The Eval Endpoint

The repository root contains `test.sh`, which shows the expected eval payload contract. For a local smoke test, you can call the endpoint directly:

```sh
export BASE_URL=http://localhost:8010
export API_KEY=local-dev-key
```

```sh
curl -i "$BASE_URL/api/v1" \
  -H "X-API-Key: $API_KEY"
```

```sh
curl -sS "$BASE_URL/api/v1/evals/run?run_id=smoke-risk-001" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  --data @/tmp/npa-evals-smoke.json | jq .
```

If auth is disabled locally, remove the `X-API-Key` header.

## Validate Evals From `/Users/aviral/Projects/Onfi/evals-basecamp`

This agent is meant to be exercised by the trace-first runner in your local harness checkout at `/Users/aviral/Projects/Onfi/evals-basecamp`.

1. Install and build the harness:

```sh
cd /Users/aviral/Projects/Onfi/evals-basecamp
pnpm install
pnpm build
```

2. Point the harness at this running agent:

```sh
export EXTERNAL_AGENT_ENDPOINT=http://localhost:8010/evals/run
export EXTERNAL_AGENT_TIMEOUT_MS=180000
```

If auth is enabled on the executor, also set:

```sh
export EXTERNAL_AGENT_API_KEY=local-dev-key
```

3. Run all scenarios:

```sh
cd /Users/aviral/Projects/Onfi/evals-basecamp
./scripts/run-npa-evals.sh
```

4. Run one scenario while iterating:

```sh
cd /Users/aviral/Projects/Onfi/evals-basecamp
./scripts/run-npa-evals.sh \
  --scenario fixtures/scenarios/compliance-001.json
```

Outputs are written under:

- `/Users/aviral/Projects/Onfi/evals-basecamp/runs/npa-evals/<timestamp>/collected`
- `/Users/aviral/Projects/Onfi/evals-basecamp/runs/npa-evals/<timestamp>/evaluated`

## Run Against A Deployed Agent

To validate the same evals against a deployed executor instead of local Docker:

```sh
cd /Users/aviral/Projects/Onfi/evals-basecamp
EXTERNAL_AGENT_ENDPOINT=http://<host>/api/v1/evals/run \
EXTERNAL_AGENT_API_KEY=<workspace-agent-api-key> \
EXTERNAL_AGENT_TIMEOUT_MS=180000 \
./scripts/run-npa-evals.sh
```

## Troubleshooting

- `401 missing or invalid API key`: align `WORKSPACE_AGENT_API_KEYS` with `EXTERNAL_AGENT_API_KEY`, or disable auth locally.
- `connection refused`: wait for `docker compose up --build` to finish, then retry `http://localhost:8010/api/v1/readyz`.
- model call failures: verify `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `WORKSPACE_AGENT_MODEL` in `.env`.
- traces and run outputs from the executor are written under `npa-evals-executor-agent/traces` and the configured MinIO buckets.

For Kubernetes deployment details, see `k8s/npa-evals/README.md`.
