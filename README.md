# NPA Workspace Agent Smoke Test Repo

This branch is intentionally small. After this README is added, the repo root contains:

1. `npa-evals-executor-agent/`
2. `test.sh`
3. `README.md`

## What This Repo Contains

- `npa-evals-executor-agent/`: the HTTP workspace agent service
- `test.sh`: a smoke test for the agent eval API
- `README.md`: this run guide

## What This Setup Is For

This repo is used to validate the NPA eval executor agent through its HTTP API.

The main flow is:

1. run the agent locally or point to a deployed agent
2. run `test.sh`
3. confirm the API accepts the eval payload and returns a valid response

## Requirements

To run the agent locally:

- Docker with `docker compose`
- an OpenAI-compatible model endpoint
- a valid model API key
- `curl`
- `jq`
- `awk`

To run only the smoke test against a deployed agent:

- `curl`
- `jq`
- `awk`
- a valid workspace agent API key

## Repo Layout

```text
.
├── README.md
├── npa-evals-executor-agent/
└── test.sh
```

## Run The Agent Locally

1. Go into the agent folder:

```sh
cd npa-evals-executor-agent
```

2. Fill in `.env` with valid values:

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

If you want auth enabled, also add:

```sh
WORKSPACE_AGENT_API_KEYS=local-dev-key
```

3. Create the bind-mount directories used by compose:

```sh
mkdir -p IIFL-artifacts
mkdir -p traces
```

4. Start the service:

```sh
cd npa-evals-executor-agent
docker compose up --build
```

5. Check the service:

```sh
curl http://localhost:8010/api/v1/healthz
curl http://localhost:8010/api/v1/readyz
```

If auth is enabled:

```sh
curl http://localhost:8010/api/v1 \
  -H 'X-API-Key: local-dev-key'
```

## Run `test.sh`

From the repo root:

```sh
./test.sh
```

By default the script:

- reads the API key from `npa-evals-executor-agent/k8s/npa-evals/agent-executor-secrets.env`
- uses the deployed base URL `http://npa-evals-agent-1097588215.ap-south-1.elb.amazonaws.com`
- writes the request payload to `/tmp/npa-evals-smoke.json`
- stores response headers in `/tmp/npa-evals-response-headers.txt`
- stores response body in `/tmp/npa-evals-response-body.txt`

## What `test.sh` Does

Sequence-wise, `test.sh` does this:

1. resolves `ROOT_DIR` from the script location
2. sets `SECRET_ENV_FILE` if you did not pass one in the environment
3. sets `BASE_URL` if you did not pass one in the environment
4. reads `WORKSPACE_AGENT_API_KEYS` from the secrets env file when `API_KEY` is not already exported
5. fails early if no API key is available
6. writes a fixed smoke-test JSON payload to `/tmp/npa-evals-smoke.json`
7. calls `GET $BASE_URL/api/v1` with `X-API-Key` to verify auth and service reachability
8. calls `POST $BASE_URL/api/v1/evals/run?run_id=smoke-risk-001` with that JSON payload
9. saves response headers and body to `/tmp`
10. pretty-prints the response body with `jq` when possible, otherwise prints raw output

## What Payload `test.sh` Sends

The script sends one synthetic eval request with:

- scenario id: `scenario-risk-001-smoke`
- task family: `risk`
- execution mode: `initial`
- run id: `smoke-risk-001`
- one artifact snapshot: `workspace/case/risk-note.md`
- one expected outcome: keep residual risk high because vendor remediation is incomplete

This smoke test proves that:

- authentication works
- the API contract is accepted
- the agent can process one eval request end to end

## Useful Overrides

Run against local Docker:

```sh
BASE_URL=http://localhost:8010 API_KEY=local-dev-key ./test.sh
```

Use a different secrets file:

```sh
SECRET_ENV_FILE=/path/to/agent-executor-secrets.env ./test.sh
```

Set everything explicitly:

```sh
BASE_URL=http://localhost:8010 \
API_KEY=local-dev-key \
./test.sh
```

## Expected Output

The script prints:

- an auth check response for `/api/v1`
- response headers from `/api/v1/evals/run`
- the JSON response body from the eval run

If the body is valid JSON, it will be formatted by `jq`.

## Troubleshooting

- `Missing secrets file`: the default `SECRET_ENV_FILE` path does not exist. Pass `API_KEY` directly or set `SECRET_ENV_FILE`.
- `WORKSPACE_AGENT_API_KEYS is empty`: the secrets file exists but does not contain a value for `WORKSPACE_AGENT_API_KEYS`.
- `401 missing or invalid API key`: the target agent rejected the API key.
- `connection refused`: the local agent is not running, or the target host is wrong.
- model/provider failures: check `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `WORKSPACE_AGENT_MODEL` in `npa-evals-executor-agent/.env`.

## Related Files

- `npa-evals-executor-agent/`
- `npa-evals-executor-agent/README.md`
- `npa-evals-executor-agent/k8s/npa-evals/agent-executor-secrets.env.example`
- `test.sh`
