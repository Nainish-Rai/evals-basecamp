# Historical Regression Baselines Implementation Plan

Date: 2026-03-28
Status: In progress
Depends on: `docs/plans/2026-03-28-historical-regression-baselines-design.md`

## Notes

- This plan is written directly because the `writing-plans` skill referenced by the brainstorming workflow is not available in this session.
- The goal is MVP historical regression support for `smoke` and `release`, not a full baseline management product.

## Milestone Slice

Build the smallest complete path that allows:

1. evaluating a named subset
2. writing a baseline artifact for that subset
3. evaluating a fresh run against that baseline
4. failing when regressions exceed subset-specific thresholds

## Deliverables

- subset manifest schema and loader
- `smoke` and `release` manifest files
- baseline artifact schema
- historical regression comparison report
- regression gate evaluator
- baseline-aware `run:eval:evaluate` CLI
- unit and integration coverage for the new contracts and reporting path

## Tasks

### 1. Contracts

- add subset manifest schema
- add regression threshold schema
- add baseline artifact schema
- extend `EvaluatedExample` with stable agent identity fields

Exit criteria:

- invalid manifests and invalid baseline artifacts fail schema validation

### 2. Repo Fixtures

- add `smoke` subset manifest
- add `release` subset manifest

Exit criteria:

- manifests reference current scenario ids in the repo

### 3. Historical Reporting

- build example matching using example id, variant group id, mode, agent label, and model label
- compute per-example historical deltas
- summarize subset-level regressions
- compute threshold violations and missing coverage

Exit criteria:

- reports distinguish configuration errors from metric regressions

### 4. CLI Integration

- add optional subset, baseline, and write-baseline flags
- load the subset manifest
- write baseline artifacts when requested
- emit historical regression artifacts when a baseline is provided
- fail non-zero when `--fail-on-regression` is used and violations exist

Exit criteria:

- baseline-less local evaluation still works unchanged
- baseline-aware evaluation emits the new artifacts

### 5. Verification

- add unit tests for comparison and gate logic
- add integration coverage for baseline writing and checking
- run `pnpm test`
- run `pnpm typecheck`

Exit criteria:

- new regression path is covered by tests
- no existing evaluation flow regresses
