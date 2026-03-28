# NPA Evals Kubernetes Manifests

This overlay deploys the workspace `agent-executor` for benchmark and eval traffic into the `npa-evals` namespace.

Included resources:

- `agent-executor` deployment
- `agent-executor` service
- `agent-executor` public ALB ingress
- workspace and trace PVCs
- executor config and secrets
- `agent-executor` VerticalPodAutoscaler
- `/evals/run`, which lets `evals-basecamp` call the real workspace agent through the harness HTTP contract

Before applying:

1. Review the checked-in defaults in [configmaps.yaml](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/configmaps.yaml).
2. Create a local secrets file from [agent-executor-secrets.env.example](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/agent-executor-secrets.env.example) and fill in real values.
3. Keep the populated `agent-executor-secrets.env` file out of git. The overlay now generates `agent-executor-secrets` via kustomize, so the deployment no longer depends on cluster-specific `cos-common-secrets`.
4. The deploy script now refuses to run if any secret value is missing or still starts with `replace-me`.
5. Set the LLM model in [configmaps.yaml](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/configmaps.yaml) only if you need something other than the default `gpt-4o-mini`.
6. Update the image tag in [agent-executor.yaml](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/agent-executor.yaml).
7. Install Metrics Server and the VPA CRDs/controllers in the cluster before applying this overlay.

Required secret keys:

- `OPENAI_API_KEY`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `WORKSPACE_AGENT_API_KEYS`

Bootstrap the local secret file:

```sh
cp /Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/agent-executor-secrets.env.example \
  /Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/npa-evals/agent-executor-secrets.env
```

Install the cluster-wide VPA components once per cluster:

```sh
bash /Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/scripts/install-vpa-cluster-components.sh
```

Apply:

```sh
/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/scripts/deploy-npa-evals.sh
```

Basic checks:

```sh
kubectl get pods -n npa-evals
kubectl get svc -n npa-evals
kubectl get ingress -n npa-evals
kubectl get ingress agent-executor -n npa-evals -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
kubectl logs deploy/agent-executor -n npa-evals
kubectl get vpa -n npa-evals
kubectl describe vpa agent-executor -n npa-evals
```

Evals harness endpoint:

```sh
export EXTERNAL_AGENT_ENDPOINT="http://agent-executor.npa-evals.svc.cluster.local:8010/evals/run"
export EXTERNAL_AGENT_TIMEOUT_MS=180000
```

Local port-forward for debugging:

```sh
kubectl port-forward -n npa-evals svc/agent-executor 8010:8010
export EXTERNAL_AGENT_ENDPOINT="http://localhost:8010/evals/run"
```

Run `evals-basecamp` against the deployed agent:

```sh
cd /Users/aviral/Projects/Onfi/evals-basecamp/evals-basecamp
EXTERNAL_AGENT_ENDPOINT="http://localhost:8010/evals/run" pnpm run run:eval:npa
```

Or, if the eval runner is itself inside the cluster network:

```sh
cd /Users/aviral/Projects/Onfi/evals-basecamp/evals-basecamp
EXTERNAL_AGENT_ENDPOINT="http://agent-executor.npa-evals.svc.cluster.local:8010/evals/run" pnpm run run:eval:npa
```

Public ALB endpoint:

```sh
ALB_HOST="$(kubectl get ingress agent-executor -n npa-evals -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
export BASE_URL="http://$ALB_HOST"
export API_KEY="<value-from-WORKSPACE_AGENT_API_KEYS>"
echo "$BASE_URL"
echo "http://$ALB_HOST/docs"
echo "http://$ALB_HOST/openapi.json"
curl -sS "$BASE_URL/api/v1" -H "X-API-Key: $API_KEY"
```

Notes:

- Kubernetes object and namespace names must be lowercase, so the deployment namespace is `npa-evals`.
- This overlay is separate from `k8s/iifl-batch-job` and can be deployed independently for agent evaluation.
- The helper deploy script only targets `k8s/npa-evals`; it does not apply `k8s/iifl-batch-job`.
- The current live ingress is a single public ALB. At the time of inspection it resolved to `npa-evals-agent-1097588215.ap-south-1.elb.amazonaws.com`.
- The earlier runtime failures were caused by an exhausted Anthropic-backed model default and invalid MinIO credentials sourced from a cluster-global secret. This overlay now expects one explicit local secret contract instead.
- **IRSA requirement:** create an IAM role with Bedrock/S3 permissions, annotate `npa-evals-agent-executor` with `eks.amazonaws.com/role-arn`, and keep the service account in this overlay so the pod inherits those credentials instead of storing keys in secrets.
