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
pnpm test
pnpm lint
pnpm typecheck
```

build the project:

```bash
pnpm build
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
5. add or update tests
6. run `pnpm test`, `pnpm lint`, and `pnpm typecheck`

this repo should reward contributors who make the next scenario, the next contract, or the next evaluation step more legible than the last one.

## tracing and agent boundary

milestone 5 adds the tracing layer around the external http agent contract.
the runner will trace the benchmark run itself, then record the outbound agent
call, latency, errors, and harness-side scores without requiring the agent
implementation to live in this repo.

the intended shape is simple:

- one scenario run maps to one top-level trace
- each execution mode gets its own child span
- the outbound agent request is wrapped as a traced operation
- score writes stay in the harness so local and remote agents are evaluated the same way

milestone 6 now adds a local tool-chain agent path inside the repo for contract-first development.
that agent records:

- graph path and feedback-aware rerun state
- tool specs and tool creation events
- tool call ledgers including succeeded, failed, and skipped calls
- explicit budget accounting
- memory and multimodal normalization metadata

the intent is to keep milestone 7 normalization simple: the runner should not need to infer these details after the fact if the agent can emit them directly.

## near-term roadmap

the current plan points toward a few concrete milestones:

- expand synthetic financial compliance coverage across compliance, governance, investigation, and risk tasks
- extend the built-in tool-chain agent and add the workspace agent
- normalize results into one evaluation record
- score drift, context efficiency, and memory behavior
- trace runs in a way that supports debugging and regression review

if you are looking for leverage, contribute where these milestones still have obvious gaps.

## the open source invitation

this repo is not trying to be a polished eval product on day one.

it is trying to become a method that other teams can inspect, fork, criticize, and improve. that only works if contributors treat the repo as shared evaluation infrastructure, not as a private experiment with public code.

if that framing matches how you think about evals, you will likely find good work to do here.
