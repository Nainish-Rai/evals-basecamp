# Workspace Agent Kubernetes Manifests

This overlay now deploys only the workspace `agent-executor` into the `iifl-batch-job` namespace.

Included resources:

- `agent-executor` deployment
- `agent-executor` service
- workspace and trace PVCs
- executor config and secrets
- `agent-executor` VerticalPodAutoscaler
- `/evals/run`, which lets `evals-basecamp` call the real workspace agent through the harness HTTP contract

Also retained in this repo:

- `jobs/workspace-excel-batch`, which submits work directly to the executor `/batches` API

Before applying:

1. Review the checked-in defaults in [configmaps.yaml](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/iifl-batch-job/configmaps.yaml).
2. Replace all placeholder values in [secrets.yaml](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/iifl-batch-job/secrets.yaml) before using `kubectl apply -k`.
   Required keys:
   `OPENAI_API_KEY`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`
3. Confirm the referenced executor image tag in [agent-executor.yaml](/Users/aviral/Projects/Onfi/ICICI_SAAS/ICICI_SAAS/k8s/iifl-batch-job/agent-executor.yaml) is correct for your environment.
4. Install the Vertical Pod Autoscaler CRDs and controllers in the cluster before applying this overlay.

Apply:

```sh
kubectl apply -k k8s/iifl-batch-job
```

Basic checks:

```sh
kubectl get pods -n iifl-batch-job
kubectl get svc -n iifl-batch-job
kubectl logs deploy/agent-executor -n iifl-batch-job
kubectl get vpa -n iifl-batch-job
kubectl describe vpa agent-executor -n iifl-batch-job
```

Batch job overlay:

```sh
kubectl apply -k k8s/iifl-batch-job/jobs/workspace-excel-batch
kubectl logs job/workspace-excel-batch -n iifl-batch-job
```

To connect the eval harness to this deployment, point `evals-basecamp` at:

```sh
export EXTERNAL_AGENT_ENDPOINT="http://agent-executor.iifl-batch-job.svc.cluster.local:8010/evals/run"
```
