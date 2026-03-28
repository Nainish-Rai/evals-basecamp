# evals basecamp

evals basecamp is an open source method for building agent evals in the open.

most eval systems break in the same place. the scenarios live in one tool, the scoring logic lives in another tool, the traces live somewhere else, and contributors cannot see the full contract. that makes evaluation hard to trust, hard to review, and hard to improve together.

this repo takes a different path. scenarios are versioned in git. schemas are explicit. runs are meant to normalize into one shared record. the method is simple: if an eval cannot be inspected, changed, and discussed by contributors, it is not strong enough yet.

## what this repo is trying to build

this project is building a scenario-centric evaluation harness for agent systems, with an early focus on financial compliance workflows.

the goal is not just to score answers. the goal is to evaluate how an agent behaves when context is noisy, feedback arrives midstream, memory matters, and the same task must be judged across different agent architectures.

the current design targets:

- response quality drift
- context efficiency
- memory utilization
- feedback integration
- shared evaluation contracts across agent families

the long-term bet is that open evals should behave more like open infrastructure:

- versioned
- inspectable
- reproducible
- contributor-friendly

## what exists today

the repo is early, but it already has the foundation for contributors to build on:

- typed scenario, pack, feedback, memory, and metric schemas with `zod`
- fixture loaders that validate json files and fail fast on bad data
- synthetic fixtures across compliance, governance, investigation, and risk tasks
- environment validation for model and tracing configuration
- a scenario runner that can materialize fixtures and execute initial + feedback rerun flows
- a deterministic tool-chain agent that records graph path, tool specs, tool calls, budget data, memory events, and multimodal normalization metadata
- an external HTTP agent boundary that preserves the harness-owned trace contract
- a trace-first collection and evaluation flow that emits machine-readable artifacts for manual review
- trajectory scoring via both a canonical trajectory score and a separate heuristic trajectory coverage metric
- feedback-rerun comparison reports for initial run vs rerun inspection within the same collected bundle set
- unit and integration tests for contracts, loaders, runner behavior, and tool-chain execution metadata
- design and implementation docs in `docs/plans`

that matters because it gives contributors a stable place to extend the method instead of debating structure from scratch every time.

## why this method is different

many eval projects start with prompts and dashboards. this one starts with contracts.

that choice changes the shape of the work:

- scenarios are first-class artifacts, not hidden rows in a product ui
- expected outcomes, feedback turns, and memory checkpoints can be reviewed in pull requests
- different agent families can be measured against the same scenario contract
- contributors can improve the benchmark without needing private platform access

if you want evals that survive model churn, framework churn, and team churn, this is the direction.

## quick start

requirements:

- node 20+
- pnpm

install and validate the project:

```bash
pnpm install
pnpm build
```

optional validation commands:

```bash
pnpm test
pnpm lint
pnpm typecheck
```

the current environment contract lives in `src/infra/config/env.ts`.

the current runtime now supports two useful execution paths:

- the built-in deterministic tool-chain agent for milestone development and contract testing
- an external HTTP agent boundary for black-box vendor or company-provided agents

the tracing boundary still works the same way:

- the harness will call a company-provided http agent endpoint during eval runs
- the harness owns the trace boundary, nested spans, and score writes
- local runs still work with a no-op tracing path when langfuse is disabled
- external agents stay black-boxed from the harness point of view

to run a fixture through the current built-in stub path:

```bash
pnpm run run:scenario:stub
```

## eval usage

the current mvp flow is manual eval testing, not automated regression gating.

the main loop is:

1. collect run bundles from one scenario or a directory of scenarios
2. evaluate the collected bundles post hoc
3. inspect the generated json/jsonl artifacts

collect one scenario:

```bash
pnpm run run:eval:collect -- \
  --scenario fixtures/scenarios/compliance-001.json \
  --packs fixtures/packs \
  --output .tmp/eval-run
```

collect a scenario directory:

```bash
pnpm run run:eval:collect -- \
  --scenarios fixtures/scenarios \
  --packs fixtures/packs \
  --output .tmp/eval-run
```

evaluate collected bundles:

```bash
pnpm run run:eval:evaluate -- \
  --bundles .tmp/eval-run \
  --output .tmp/eval-report
```

write a historical baseline artifact for the `smoke` subset:

```bash
pnpm run run:eval:evaluate -- \
  --bundles .tmp/eval-run \
  --output .tmp/eval-report \
  --subset smoke \
  --write-baseline baselines/trace-first/smoke-baseline.json \
  --source-commit HEAD
```

check a fresh run against a stored baseline and fail on regression:

```bash
pnpm run run:eval:evaluate -- \
  --bundles .tmp/eval-run \
  --output .tmp/eval-report \
  --subset smoke \
  --baseline baselines/trace-first/smoke-baseline.json \
  --fail-on-regression
```

supported baseline-aware flags:

- `--subset <id>` loads `baselines/subsets/<id>.json`
- `--subset-manifest <path>` overrides the built-in subset manifest path
- `--write-baseline <path>` writes a self-contained baseline artifact
- `--baseline <path>` compares current results to a stored baseline artifact
- `--source-commit <sha>` annotates a written baseline
- `--notes <text>` adds a short note to a written baseline
- `--fail-on-regression` exits non-zero when the historical regression gate fails

## evaluation outputs

`run:eval:collect` writes:

- `run-bundles/*.json`
- `collector-workspaces/`

`run:eval:evaluate` writes:

- `evaluated-examples.jsonl`
- `metric-results.jsonl`
- `scored-run-bundles.jsonl`
- `peer-efficiency.json`
- `metric-averages.json`
- `variant-group-drift.json`
- `feedback-rerun-comparisons.jsonl`
- `feedback-rerun-comparison-summary.json`
- `historical-regression-comparisons.jsonl` when `--baseline` is provided
- `historical-regression-summary.json` when `--baseline` is provided
- `historical-regression-gate.json` when `--baseline` is provided
- `evaluation-summary.json`

these outputs are intended for inspection, scripting, and later report generation.

## what to look at during manual mvp testing

if you are manually testing the harness today, start here:

- `evaluation-summary.json` for run counts and output sanity
- `metric-averages.json` for high-level score distribution
- `evaluated-examples.jsonl` for per-run canonical scores
- `metric-results.jsonl` for scorer-specific details
- `feedback-rerun-comparisons.jsonl` for initial vs rerun changes
- `variant-group-drift.json` for within-group drift summaries

the current metric surface includes:

- accuracy
- domain correctness
- feedback integration
- memory utilization
- context efficiency
- context counterfactual scoring
- response quality drift
- canonical trajectory scoring
- heuristic `trajectory_coverage`

## current status

for manual mvp eval testing, the repo is usable now.

for automated regression testing, it is not finished yet. the main missing pieces are:

- ci thresholds and gating
- richer real workspace-agent trace fidelity

repo-backed historical baselines, smoke/release subset manifests, and baseline-vs-current comparison now exist.
the remaining gap is productionizing that flow in ci and tightening the real workspace-agent trace surface.

## project map

```text
src/
  agents/         tool-chain agent state and execution logic
  domain/         scenario, feedback, pack, and model schemas
  evals/          normalized evaluation contracts
  infra/          environment configuration
  runtime/        materialization, runner, and tracing
fixtures/
  scenarios/      versioned benchmark scenarios
  packs/          reusable synthetic domain packs
tests/
  unit/           schema, loader, http boundary, and agent coverage
  integration/    runner execution coverage
docs/plans/       design and implementation direction
```

## how to contribute

the fastest useful contributions are not cosmetic. they make the method stronger.

good first contribution paths:

1. add new scenarios under `fixtures/scenarios`
2. add reusable packs under `fixtures/packs`
3. extend the schemas when the current contract is too weak
4. extend the tool-chain and workspace agents against more scenarios
5. add normalization and metric scoring logic
6. tighten tests around fixture validation, agent metadata, and evaluation behavior

when you contribute, prefer changes that make eval behavior easier to inspect and compare later.

examples:

- add a scenario with explicit feedback turns and memory checkpoints
- add a context-heavy case with distractors and duplicated evidence
- add a metric contract that can compare baseline and current runs
- add runner behavior that preserves a clean execution record

## contribution standard

the standard in this repo is simple:

- make the contract clearer
- make the fixture more realistic
- make the evaluation more reproducible
- make the failure easier to debug

if a change makes the system look more advanced but makes it harder for contributors to inspect what happened, it is probably the wrong change.

## current workflow for contributors

if you want a practical place to start, use this loop:

1. read the design docs in `docs/plans`
2. inspect an existing fixture in `fixtures/scenarios`
3. inspect the matching schema in `src/domain/scenarios`
4. add or extend a fixture
5. collect and evaluate the scenario flow locally
6. add or update tests when you are changing contracts or runtime behavior
7. run `pnpm test`, `pnpm lint`, and `pnpm typecheck` when you change code

this repo should reward contributors who make the next scenario, the next contract, or the next evaluation step more legible than the last one.

## tracing and agent boundary

the tracing layer wraps both local and external-agent runs.
the runner traces the benchmark run itself, then records outbound agent calls,
latency, errors, and harness-side scores without requiring the agent
implementation to live in this repo.

the intended shape is simple:

- one scenario run maps to one top-level trace
- each execution mode gets its own child span
- the outbound agent request is wrapped as a traced operation
- score writes stay in the harness so local and remote agents are evaluated the same way

the local tool-chain path inside the repo is useful for contract-first development.
that agent records:

- graph path and feedback-aware rerun state
- tool specs and tool creation events
- tool call ledgers including succeeded, failed, and skipped calls
- explicit budget accounting
- memory and multimodal normalization metadata

the intent is to keep normalization simple: the runner should not need to infer these details after the fact if the agent can emit them directly.

## near-term roadmap

the current plan points toward a few concrete milestones:

- expand synthetic financial compliance coverage across compliance, governance, investigation, and risk tasks
- strengthen the real workspace agent and subagent trace surface
- add historical baseline storage and baseline-relative regression comparison
- add reporting and ci regression workflows
- improve trace-native scoring fidelity where heuristics are still doing too much

if you are looking for leverage, contribute where these milestones still have obvious gaps.

## the open source invitation

this repo is not trying to be a polished eval product on day one.

it is trying to become a method that other teams can inspect, fork, criticize, and improve. that only works if contributors treat the repo as shared evaluation infrastructure, not as a private experiment with public code.

if that framing matches how you think about evals, you will likely find good work to do here.
