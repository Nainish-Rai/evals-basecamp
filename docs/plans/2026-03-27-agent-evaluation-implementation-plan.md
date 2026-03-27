# Agent Evaluation Harness Implementation Plan

Date: 2026-03-27
Status: Ready for execution
Depends on: `docs/plans/2026-03-27-agent-evaluation-design.md`

## 1. Notes

- This plan is written directly because the `writing-plans` skill referenced by the brainstorming workflow is not available in this session.
- The implementation language is TypeScript/JavaScript.
- Existing unrelated repo changes must remain untouched.

## 2. Delivery Strategy

Build the project in thin vertical slices.

Priority order:

1. contracts
2. domain fixtures
3. runner
4. one agent
5. normalization
6. first metrics
7. second agent
8. regression and drift

This keeps the benchmark executable early and avoids building a large amount of disconnected infrastructure.

## 3. Milestones

### Milestone 1: Foundation

Deliverables:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- base source tree
- env loading and config validation
- formatting and linting scripts

Tasks:

- initialize `pnpm`
- enable TypeScript strict mode
- add runtime dependencies
- add test and dev scripts
- define environment schema for model providers and Langfuse

Exit criteria:

- `pnpm test` runs
- `pnpm typecheck` runs
- repo layout exists

### Milestone 2: Core Contracts

Deliverables:

- scenario schemas
- synthetic pack schemas
- feedback event schemas
- expected outcome schemas
- drift evaluation spec schemas
- context evaluation spec schemas
- memory evaluation spec schemas
- normalized evaluation record schema
- metric result schema

Tasks:

- create `zod` schemas under `src/evals/contracts` and `src/domain/scenarios`
- create shared TypeScript inferred types
- create schemas for:
  - expected outcome criteria
  - required findings
  - required evidence refs
  - expected escalation
  - required steps
  - critical tools
  - critical delegations
  - allowed step flexibility
- create schemas for:
  - minimum correctness threshold
  - system prompt profile
  - tool surface profile
  - required context
  - optional context
  - distractor context
  - duplicate context
  - stale context
  - context scenario types
  - agent rendering notes
  - multimodal optimization expectations
  - file read cleanup expectations
- create schemas for:
  - memory sources
  - memory scopes
  - memory opportunities
  - memory checkpoints
  - expected memory states
- add fixture loaders with validation

Exit criteria:

- invalid benchmark files fail fast
- sample benchmark cases can be loaded in tests

### Milestone 3: Synthetic Financial Compliance Domain

Deliverables:

- first synthetic packs
- first benchmark scenarios

Tasks:

- create packs for:
  - compliance
  - governance
  - investigation
  - risk
- create reviewer feedback fixtures
- hand-author initial cases before attempting generation at scale

Recommended minimum first batch:

- 12 scenarios total
- 3 per task family
- both agent families represented
- at least 6 cases with explicit feedback turns

Drift requirement for first batch:

- include at least:
  - 2 outcome-drift-sensitive cases
  - 2 trajectory-drift-sensitive cases
  - 2 cases where variation should be treated as quality-preserving rather than drift

Context requirement for first batch:

- include at least one case each for:
  - minimal sufficient context
  - under-context failure
  - over-context bloat
  - wrong-context retrieval
  - duplicate-context waste
  - mispartitioned context
  - stale or superseded context
  - artifact reuse vs regeneration
  - budget-constrained prioritization

Explicit context-overhead coverage in first batch:

- at least one case should stress:
  - system prompt overhead
  - tool definition overhead
  - duplicate or overlapping tools
  - multimodal compression
  - file read cleanup and redundancy
  - retry attribution from prompt or tool ambiguity

Memory requirement for first batch:

- cover the high-value memory states first:
  - `4` correct save, failed needed retrieval
  - `5` correct save, correct needed retrieval
  - `6` missed save, later needed
  - `8` wasteful save, wrongly used
  - `9` correct abstention from saving
- include at least one scenario for each memory source:
  - trace/tool/file memory
  - user memory
  - pattern memory

Exit criteria:

- all first-batch scenarios validate
- each task family has at least one runnable case

### Milestone 4: Scenario Runner and Environment Materializer

Deliverables:

- `ScenarioRunner`
- `CaseEnvironmentMaterializer`
- `ArtifactRegistry`
- `FeedbackReplayEngine`

Tasks:

- implement case loading
- materialize case artifacts into temp directories
- materialize synthetic data sources
- materialize context variants needed for:
  - ablation
  - distractor injection
  - progressive context addition
  - budget-constrained reruns
- materialize prompt and tool-surface variants needed for:
  - prompt-overhead analysis
  - duplicate-tool analysis
  - tool-definition-size analysis
- surface annotated memory opportunities and memory checkpoints to the runner
- surface drift annotations such as required findings, required steps, and critical tools to the runner
- surface context annotations such as required context, distractors, duplicates, stale context, and scenario type to the runner
- implement execution mode:
  - initial run
  - feedback-informed rerun
- capture artifact paths and references

Exit criteria:

- one command runs a single case end to end with a stub agent

### Milestone 5: Langfuse Tracing Layer

Deliverables:

- Langfuse client wrapper
- trace and span helpers
- score writing helpers

Tasks:

- wrap benchmark runs in top-level traces
- add span helpers for:
  - graph nodes
  - tools
  - retrieval
  - workspace writes
  - subagent calls
  - memory events
- emit structured memory decision events for:
  - observed candidate
  - saved
  - skipped save
  - retrieved
  - skipped retrieval
  - used in decision
- add safe fallbacks when Langfuse is disabled locally

Exit criteria:

- local run produces a trace with nested spans
- score helpers can attach numeric and categorical scores

### Milestone 6: Tool-Chain Agent

Deliverables:

- tool-chain state model
- tool creation path
- tool calling path
- multimodal normalization path
- feedback integration path

Tasks:

- define graph state
- implement explicit budget ledger
- implement tool spec creation contract
- normalize multimodal tool outputs before final response generation
- store tool creation and tool calling events in state

First scenario targets:

- compliance
- risk

Exit criteria:

- tool-chain agent completes at least 4 benchmark cases
- normalized record contains tool and budget data

### Milestone 7: Normalization Layer

Deliverables:

- `ToolChainAgentAdapter`
- `WorkspaceAgentAdapter`
- normalized record builder

Tasks:

- transform raw graph state plus runtime artifacts into canonical evaluation records
- attach Langfuse trace identifiers
- classify memory behavior into the annotated memory matrix where possible
- validate normalized output with `zod`

Exit criteria:

- evaluator layer can operate without knowing which agent family produced the record

### Milestone 8: First Metric Engines

Deliverables:

- domain correctness scorer
- feedback integration scorer
- context efficiency scorer

Why these first:

- they provide immediate value on financial-compliance tasks
- they exercise response, feedback, and retrieval behavior early

Tasks:

- deterministic checks for expected findings and artifact coverage
- feedback delta scoring
- retrieval and token efficiency scoring
- add correctness-gated context scoring
- add first static context metrics:
  - context precision
  - context recall
  - system prompt token overhead
  - tool definition token overhead
  - token-to-value ratio
  - context bloat index
  - duplicate context rate
- add first structure metrics:
  - context partition efficiency
  - artifact reuse rate
- add first overhead diagnostics:
  - active tool surface area
  - unused tool definition ratio
  - duplicate tool definition rate
  - tool overlap rate
  - file read redundancy rate

Exit criteria:

- benchmark run produces machine-readable scores
- context efficiency score is gated by minimum correctness threshold
- at least one score is written back to Langfuse for each run

### Milestone 9: Workspace Agent

Deliverables:

- workspace graph
- retrieval and filesystem materialization path
- smaller-model subagent delegation path
- feedback propagation path

Tasks:

- define supervisor state
- build synthetic data retrieval tools
- materialize curated context to filesystem
- enforce smaller-model subagent configuration
- capture subagent metadata and outputs

First scenario targets:

- governance
- investigation

Exit criteria:

- workspace agent completes at least 4 benchmark cases
- normalized record contains retrieval, file, and subagent data

### Milestone 10: Remaining Metric Engines

Deliverables:

- response quality drift scorer
- memory utilization scorer
- counterfactual context-efficiency scorer
- trajectory scoring integration

Tasks:

- add outcome drift scoring for:
  - outcome score delta
  - domain correctness delta
  - feedback integration delta
  - evidence grounding delta
  - required findings recall delta
  - escalation decision delta
- add trajectory drift scoring for:
  - required step coverage delta
  - tool selection precision delta
  - tool argument accuracy delta
  - unnecessary step delta
  - looping delta
  - delegation alignment delta
  - graph efficiency delta
- classify changes as:
  - quality-preserving variation
  - outcome-only drift
  - trajectory-only drift
  - combined drift
- add within-case and cross-case memory scoring
- score the nine memory utilization states across:
  - trace/tool/file memory
  - user memory
  - pattern memory
- compute:
  - memory write precision
  - memory write recall
  - memory abstention precision
  - memory read precision
  - memory read recall
  - memory impact score
- apply penalties for:
  - irrelevant retrieval
  - missed needed retrieval
  - missed needed write
  - wasteful save
  - harmful memory activation
- add counterfactual context methods:
  - ablation scoring
  - progressive context addition
  - budget-constrained robustness scoring
- compute advanced context metrics:
  - minimal sufficient context size
  - marginal context gain
  - context saturation point
  - ablation loss per artifact
  - ordering effect score
  - context inheritance redundancy
  - artifact materialization efficiency
  - multimodal context efficiency
  - image to text compression quality
  - table extraction compactness
  - audio transcript token efficiency
  - temporary artifact cleanup efficiency
  - retry due to prompt ambiguity rate
  - retry due to tool schema ambiguity rate
  - retry due to missing context rate
- integrate AgentEvals for selected stable scenarios and trajectory hints

Exit criteria:

- all required score families exist
- drift reports expose both outcome and trajectory deltas
- context efficiency reports expose both static and counterfactual metrics
- context efficiency reports expose overhead and retry-attribution diagnostics
- memory utilization reports expose both aggregate score and per-state counts
- baseline comparison is possible on a benchmark subset

### Milestone 11: Drift and Regression Pipeline

Deliverables:

- benchmark grouping
- baseline storage
- run comparison reports
- regression thresholds

Tasks:

- define:
  - smoke set
  - release set
  - sentinel set
- implement baseline snapshots
- compare current runs against stored baselines
- aggregate drift by:
  - agent family
  - task family
  - difficulty
  - feedback-aware versus non-feedback-aware scenarios
- surface drift classifications:
  - quality-preserving variation
  - outcome-only drift
  - trajectory-only drift
  - combined drift
- fail CI on configured regressions for smoke scenarios

Exit criteria:

- repeat benchmark run can report pass or fail against baseline
- drift output explains whether the regression came from outcome quality or execution path

### Milestone 12: Reports and Hardening

Deliverables:

- JSONL and CSV summaries
- markdown benchmark reports
- improved failure diagnostics

Tasks:

- export aggregates
- summarize by task family, difficulty, and agent family
- link local reports to Langfuse trace IDs
- improve logging, retries, and error messages

Exit criteria:

- benchmark results are usable without reading raw traces

## 4. Initial File Plan

Suggested first files:

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `src/domain/scenarios/scenario-schema.ts`
- `src/domain/feedback/feedback-event-schema.ts`
- `src/evals/contracts/normalized-evaluation-record.ts`
- `src/runtime/runner/scenario-runner.ts`
- `src/runtime/tracing/langfuse-tracer.ts`
- `src/agents/tool-chain/tool-chain-state.ts`
- `src/agents/tool-chain/create-tool-chain-agent.ts`
- `tests/unit/scenario-schema.test.ts`
- `tests/integration/scenario-runner.test.ts`

## 5. Benchmark Authoring Plan

### Phase A: Hand-Authored Cases

Write the first 12 scenarios manually.

Why:

- forces schema quality early
- avoids hiding design bugs inside generator output
- gives a reliable seed corpus for later synthetic scaling

### Phase B: Controlled Expansion

Expand to:

- 48 scenarios total

Then expand to the full v1 target:

- 192 scenarios total

Expansion rules:

- no scenario added without explicit rubric and expected outcomes
- keep roughly half of cases feedback-aware
- audit for redundancy every expansion cycle

## 6. Testing Plan

### Unit Tests

Focus:

- schemas
- fixture loaders
- metric functions
- normalization helpers
- drift comparison logic

### Integration Tests

Focus:

- scenario runner
- Langfuse trace emission
- tool-chain graph execution
- workspace graph execution
- filesystem materialization
- subagent model enforcement

### Regression Tests

Focus:

- smoke benchmark subset
- fixed golden scenarios
- expected score thresholds

## 7. CI and Run Modes

### Local Developer Mode

- run one case
- run one benchmark group
- optionally disable Langfuse writes

### CI Smoke Mode

- run smoke benchmark subset
- low cost
- deterministic scenarios only

### Release Mode

- run broader benchmark set
- produce baseline comparison

### Sentinel Mode

- scheduled rerun of stable scenarios
- detect drift over time

## 8. Risks and Mitigations

### Risk: Too much evaluator instability

Mitigation:

- prefer deterministic scoring first
- isolate LLM judges behind narrow interfaces
- keep judge prompts versioned

### Risk: Benchmark scenarios become vague

Mitigation:

- require explicit expected outcomes
- require explicit failure modes
- keep reviewer notes for hard cases

### Risk: Workspace agent becomes open-ended too early

Mitigation:

- start with tightly scoped artifact expectations
- use file layout checks
- avoid unconstrained delegation in first milestones

### Risk: Tool-chain agent overfits trajectory matching

Mitigation:

- use trajectory checks only on selected scenarios
- keep final quality and domain correctness as primary signals

## 9. Ownership by Module

### `domain/`

Owner responsibility:

- benchmark semantics
- scenario validation
- task family modeling

### `agents/`

Owner responsibility:

- graph behavior
- model and tool wiring
- state evolution

### `runtime/`

Owner responsibility:

- execution orchestration
- environment materialization
- adapters and artifact handling

### `evals/`

Owner responsibility:

- scoring and drift logic
- judged evaluation prompts
- benchmark reporting

### `infra/`

Owner responsibility:

- platform integrations
- Langfuse wrappers
- config and logging

## 10. First Week Execution Checklist

1. Initialize the TypeScript project.
2. Add strict schemas and type tests.
3. Create the first 12 benchmark scenarios.
4. Implement the scenario runner with a stub agent.
5. Add Langfuse tracing wrappers.
6. Implement the tool-chain agent first.
7. Build normalized record generation.
8. Implement domain correctness, feedback integration, and context efficiency scorers.
9. Implement the workspace agent.
10. Add smoke benchmark execution and baseline comparison.

## 11. Definition of Done for v1

v1 is complete when:

1. Both agent families can run benchmark scenarios.
2. All four financial compliance task families are represented.
3. Feedback-informed reruns are scored.
4. The required metric families are implemented.
5. Langfuse traces and scores are written for benchmark runs.
6. A smoke benchmark can run in CI.
7. A release benchmark can compare to baseline.

## 12. Immediate Next Step

After this plan is accepted, the next implementation action should be:

1. scaffold the TypeScript project
2. define benchmark and normalized-record contracts
3. add the first hand-authored synthetic scenarios
