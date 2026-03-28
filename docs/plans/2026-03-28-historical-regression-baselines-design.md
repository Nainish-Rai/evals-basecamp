# Historical Regression Baselines Design

Date: 2026-03-28
Status: Approved for implementation
Depends on:

- `docs/plans/2026-03-27-agent-evaluation-design.md`
- `docs/plans/2026-03-27-agent-evaluation-implementation-plan.md`

## 1. Purpose

Add an MVP historical regression system for the trace-first evaluation flow.

The current harness can:

- collect run bundles
- evaluate them post hoc
- compare initial vs feedback rerun behavior inside the same bundle set

The current harness cannot yet:

- compare a fresh run to a historical baseline from an earlier commit or release
- gate a benchmark subset on explicit regression thresholds
- distinguish a fast smoke suite from a broader release suite using the same baseline system

This milestone closes that gap with a repo-backed baseline artifact format, named subset manifests, and a baseline-aware evaluation CLI.

## 2. Scope

### In Scope

- repo-versioned subset manifests for `smoke` and `release`
- repo-backed historical baseline artifact format
- historical comparison reports between current evaluated examples and stored baselines
- subset-aware regression thresholds
- CLI support for:
  - loading subset manifests
  - writing baseline artifacts
  - checking current results against a stored baseline
  - failing with a non-zero exit code when regression thresholds are violated

### Out of Scope

- external baseline storage
- baseline promotion workflows
- dashboard or web UI
- flake mitigation logic
- automatic scenario collection by subset id alone

## 3. Design Principles

- Keep the baseline system file-backed and inspectable.
- Reuse the canonical evaluated-example contract instead of inventing a second scoring format.
- Keep feedback-rerun comparison and historical regression comparison as separate layers.
- Gate only on canonical metrics, not on diagnostic-only fields.
- Start with two named subsets, but use one shared contract underneath.

## 4. Subset Model

Two subsets are supported from day one:

- `smoke`
  - small, fast, CI-oriented
  - intended for every PR
- `release`
  - broader, slower, more representative
  - intended for main or explicit regression sweeps

Each subset manifest defines:

- `subsetId`
- `label`
- `description`
- `expectedScenarioIds`
- `regressionThresholds`

Scenario selection still happens at collection time. The manifest is used to validate that the evaluated run set actually matches the expected subset shape and to apply the right thresholds.

## 5. Baseline Artifact Model

Each baseline artifact stores:

- artifact metadata
  - `artifactVersion`
  - `subsetId`
  - `createdAt`
  - `sourceCommit`
  - `notes`
- the subset manifest snapshot used when the baseline was created
- current metric summaries
- canonical evaluated examples

The baseline artifact is intentionally self-contained. Historical comparison should not need old raw run bundles, external tracing systems, or network access.

## 6. Historical Comparison Model

Historical regression is separate from feedback-rerun comparison.

Feedback-rerun comparison answers:

- did the rerun improve relative to the initial run in the same scenario execution?

Historical regression answers:

- did today’s result regress relative to the stored baseline for the same benchmark subset?

Comparison matching uses a stable logical key built from:

- `exampleId`
- `variantGroupId`
- `mode`
- `agentLabel`
- `modelLabel`

This avoids accidental cross-agent or cross-mode comparisons.

## 7. Gated Metrics

Regression thresholds apply only to canonical metrics:

- `domainCorrectnessScore`
- `trajectoryScore`
- `contextScore`
- `memoryScore`
- response quality drift metric score when present

Heuristic-only metrics such as `trajectory_coverage` remain diagnostic and reportable, but they do not gate the subset.

## 8. CLI Behavior

`run:eval:evaluate` gains optional arguments:

- `--subset <id>`
- `--subset-manifest <path>`
- `--baseline <path>`
- `--write-baseline <path>`
- `--source-commit <sha>`
- `--notes <text>`
- `--fail-on-regression`

Behavior:

- without baseline inputs, the CLI behaves like today and emits current evaluation artifacts
- with `--write-baseline`, it also writes a baseline artifact for the current evaluation
- with `--baseline`, it emits historical comparison reports
- with `--fail-on-regression`, it exits non-zero when threshold violations or subset coverage failures occur

## 9. Outputs

Historical regression adds:

- `historical-regression-comparisons.jsonl`
- `historical-regression-summary.json`
- `historical-regression-gate.json`

The existing files remain in place.

## 10. Error Handling

The CLI should fail clearly when:

- a subset id is requested but no manifest can be found
- current evaluated examples do not cover the manifest’s expected scenario ids
- a baseline artifact references a different subset than the requested current run
- the baseline and current run sets have no comparable examples

These failures are configuration errors, not score failures.

## 11. Testing Strategy

Add tests for:

- subset manifest schema and loading
- baseline artifact schema
- historical comparison matching and delta calculation
- regression gate evaluation
- CLI-level artifact generation for subset-aware evaluation

## 12. Implementation Notes

- Extend the canonical evaluated example with agent identity fields needed for stable historical matching.
- Keep code changes narrow and inside `src/evals/trace-first` plus shared contracts.
- Do not block manual MVP usage on the presence of baseline artifacts.
