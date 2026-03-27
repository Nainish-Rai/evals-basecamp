# Agent Evaluation Harness Design

Date: 2026-03-27
Status: Approved for implementation
Primary stack: TypeScript, LangChain, LangGraph, Langfuse, AgentEvals

## 1. Purpose

Build a benchmark and evaluation harness for two LangGraph agent architectures:

1. A tool-chain agent made of:
   - a tool creation agent that can create tools from user instructions
   - a tool calling agent that can handle multimodal tool outputs and track its own tool budget
2. A workspace agent that:
   - curates context from a database into a filesystem
   - can spawn subagents
   - must use a smaller model for subagents than for the main agent

The harness must evaluate both agent types on:

1. Response Quality Drift
2. Context Efficiency
3. Memory Utilization

Both agent types must also support:

1. User feedback integration
2. Financial compliance officer task simulation across:
   - Compliance tasks
   - Governance tasks
   - Investigation tasks
   - Risk tasks

`Multiplayer memory` is explicitly deferred for v1.

## 2. Core Recommendation

Use a `Langfuse + AgentEvals` architecture.

Why this is the recommended path:

- Langfuse is the primary observability and scoring system.
- AgentEvals is used where trajectory or rubric-based intermediate-step evaluation is valuable.
- Benchmark datasets remain version-controlled in Git instead of being hidden inside a platform-specific UI.
- The evaluation harness owns the canonical execution contract, which reduces coupling to LangGraph internals and provider SDK churn.

## 3. Design Principles

### System Design Principles

- Start with requirements, not framework features.
- Keep one normalized evaluation contract for both agent families.
- Start vertical and simple: one process, file-backed datasets, local reports, platform tracing.
- Add queues, caching, or more storage only when benchmark volume justifies them.
- Make observability part of the runtime, not an afterthought.

### Clean Code Principles

- Use intention-revealing names.
- Keep modules narrow and responsibilities explicit.
- Separate domain logic from framework logic.
- Keep evaluator code deterministic and composable where possible.
- Wrap external SDK failures in project-specific exceptions.

## 4. Scope

### In Scope for v1

- TypeScript benchmark runner
- Synthetic financial compliance benchmark scenarios
- Tool-chain agent implementation
- Workspace agent implementation
- Langfuse tracing and scoring
- AgentEvals integration for trajectory scoring
- Metrics for drift, context efficiency, memory utilization, domain correctness, and feedback integration
- Benchmark groups for smoke, release, and sentinel drift monitoring

### Out of Scope for v1

- Real financial customer data
- Real production compliance workflows
- Multi-user shared memory semantics
- Full web dashboard product
- Large-scale distributed execution

## 5. Functional Requirements

The system must:

1. Load benchmark cases from versioned files in the repository.
2. Materialize a synthetic case environment from reusable domain packs.
3. Execute either agent type against the same scenario contract.
4. Capture execution telemetry and evaluation scores in Langfuse.
5. Normalize every run to a shared evaluation record.
6. Score runs on the required metric families.
7. Compare current results to baselines for drift detection.
8. Support multi-turn scenarios with user feedback or reviewer feedback.
9. Produce reproducible reports and machine-readable artifacts.

## 6. Non-Functional Requirements

- Maintainable enough for frequent benchmark growth
- Deterministic enough to catch regressions
- Traceable enough to debug failures at node, tool, and subagent level
- Cheap enough to run a smoke suite in CI
- Extensible enough to add more task families and memory modes later

## 7. Benchmark Domain Model

The benchmark is `scenario-centric`, not prompt-centric.

Each scenario represents a synthetic financial compliance case with:

- a case brief
- structured evidence
- policies and controls
- synthetic transactions and alerts
- expected findings
- one or more feedback turns

### Scenario Schema

Each scenario should include:

- `scenarioId`
- `agentFamily`
- `taskFamily`
- `difficulty`
- `modalityProfile`
- `caseBrief`
- `environmentSeed`
- `artifacts`
- `availableDataSources`
- `availableTools`
- `expectedOutcomes`
- `trajectoryHints`
- `driftEvaluationSpec`
- `contextEvaluationSpec`
- `feedbackTurns`
- `memoryTargets`
- `memoryEvaluationSpec`
- `evaluationRubric`
- `failureModes`

### Scenario Lifecycle

Most scenarios should run in two phases:

1. Initial execution
2. Feedback-informed execution

This is required to test whether agents genuinely integrate reviewer feedback.

### Context Evaluation Spec

Context-sensitive scenarios should explicitly annotate:

- `minimumCorrectnessThreshold`
  - the run must meet this bar before earning a strong context-efficiency score
- `requiredContext`
  - evidence or policy sections that must be available
- `optionalContext`
  - useful but non-essential context
- `distractorContext`
  - plausible but irrelevant context
- `duplicateContext`
  - repeated context elements across chunks, files, or tool outputs
- `staleContext`
  - superseded or outdated context that should not dominate
- `contextScenarioType`
  - minimal sufficient context
  - under-context failure
  - over-context bloat
  - wrong-context retrieval
  - duplicate-context waste
  - misordered context
  - mispartitioned context
  - stale or superseded context
  - artifact reuse vs regeneration
  - budget-constrained prioritization
- `agentRenderingNotes`
  - how the same context test should be rendered for tool-chain versus workspace agents

### Drift Evaluation Spec

Drift-sensitive scenarios should explicitly annotate:

- `expectedOutcomeCriteria`
  - correctness expectations
  - required findings
  - required evidence refs
  - expected escalation or disposition
- `trajectoryHints`
  - expected nodes or phases
  - required steps
  - critical tools
  - critical delegations
- `allowedStepFlexibility`
  - exact
  - partial
  - unordered
- `driftCriticality`
  - whether a change is:
    - quality-preserving variation
    - trajectory-only drift
    - outcome-only drift
    - combined drift
- `baselineComparisonMode`
  - absolute rubric scoring
  - baseline-relative comparison

### Memory Evaluation Spec

Memory-sensitive scenarios should explicitly annotate:

- `memorySources`
  - `traceToolFile`
  - `user`
  - `pattern`
- `memoryScope`
  - `step`
  - `case`
  - `crossCase`
- `memoryOpportunities`
  - what was worth saving
  - what was not worth saving
  - what would be needed later
- `memoryCheckpoints`
  - where retrieval should or should not happen
- `expectedMemoryState`
  - which of the nine memory utilization states should be observed
- `expectedMemoryImpact`
  - `positive`
  - `neutral`
  - `negative`

## 8. Financial Compliance Task Families

### Compliance

Examples:

- KYC evidence gap analysis
- sanctions and PEP review
- suspicious activity narrative support
- transaction monitoring alert disposition

### Governance

Examples:

- policy-to-control mapping
- control ownership gap identification
- governance summary drafting
- obligation summarization from policy sources

### Investigation

Examples:

- activity timeline reconstruction
- linked entity analysis
- conflicting evidence comparison
- investigator summary with evidence citations

### Risk

Examples:

- customer risk-rating review
- control risk gap identification
- third-party risk assessment
- emerging risk trend summarization

## 9. Benchmark Coverage Matrix

For each task family and each agent family, v1 should cover:

- easy, medium, and hard cases
- single-turn and feedback-turn cases
- clean evidence and noisy evidence
- structured-only and multimodal-assisted cases
- budget-normal and budget-tight cases
- memory-light and memory-required cases

### Initial Size Recommendation

Per agent family:

- 24 compliance scenarios
- 24 governance scenarios
- 24 investigation scenarios
- 24 risk scenarios

Total:

- 96 scenarios per agent family
- 192 scenarios overall

Difficulty split per family:

- 8 easy
- 12 medium
- 4 hard

About half of all scenarios should include explicit reviewer feedback turns.

## 10. Synthetic Domain Packs

Reusable synthetic packs should provide shared, controlled environments:

- `customer-pack`
- `transaction-pack`
- `policy-pack`
- `alert-pack`
- `governance-pack`
- `risk-pack`
- `feedback-pack`

These packs let multiple scenarios vary one factor at a time, which improves regression sensitivity and drift analysis.

## 11. Target Agent Architectures

### Tool-Chain Agent

Responsibilities:

- interpret a user task
- decide whether to create or reuse tools
- create tool specs when needed
- call tools under explicit budget constraints
- handle multimodal tool outputs
- integrate reviewer feedback in later turns

Recommended high-level graph nodes:

- `planToolWork`
- `createToolSpec`
- `registerTool`
- `checkBudget`
- `selectTool`
- `executeTool`
- `normalizeMultimodalOutput`
- `applyFeedback`
- `composeFinalAnswer`

State should explicitly track:

- `toolCatalog`
- `toolCreationEvents`
- `toolCallLedger`
- `budgetLedger`
- `feedbackLedger`
- `caseMemory`
- `tokenUsage`

### Workspace Agent

Responsibilities:

- plan larger case work
- retrieve relevant context from synthetic databases
- curate context into a filesystem workspace
- delegate to smaller-model subagents
- integrate reviewer feedback across iterations
- synthesize final findings

Recommended high-level graph nodes:

- `planCase`
- `retrieveContext`
- `materializeWorkspace`
- `delegateSubtask`
- `collectSubagentResults`
- `applyFeedback`
- `composeFinalAnswer`

State should explicitly track:

- `retrievalLedger`
- `workspaceArtifacts`
- `subagentAssignments`
- `subagentOutputs`
- `feedbackLedger`
- `caseMemory`
- `tokenUsage`

Subagent requirement:

- subagents must use a smaller model tier than the main agent
- the runtime must capture model identity so this can be evaluated

## 12. Core Architecture

Execution pipeline:

`Scenario Registry -> Scenario Runner -> Environment Simulator -> Agent Adapter -> LangGraph Agent -> Langfuse Trace -> Normalized Evaluation Record -> Metric Engines -> Drift Engine -> Reports`

### Architectural Boundary

The critical design boundary is:

`agent execution` must be separate from `evaluation computation`

That means:

- evaluators do not inspect arbitrary graph internals directly
- evaluators consume a normalized record
- adapters are the only layer allowed to translate raw graph state into evaluation contracts

## 13. Normalized Evaluation Record

Every agent run must normalize to one shared record.

Recommended fields:

- `scenarioId`
- `runId`
- `agentFamily`
- `taskFamily`
- `turnId`
- `inputTask`
- `feedbackInputs`
- `finalResponse`
- `groundedEvidenceRefs`
- `toolSpecsCreated`
- `toolCalls`
- `budgetLedger`
- `retrievalEvents`
- `filesystemArtifacts`
- `subagentEvents`
- `outcomeScore`
- `domainCorrectnessScore`
- `feedbackIntegrationScore`
- `evidenceGroundingScore`
- `requiredFindingsCovered`
- `evidenceRefsUsed`
- `escalationDecision`
- `memoryCandidatesObserved`
- `memoryReads`
- `memoryWrites`
- `memoryWritesSkipped`
- `memorySources`
- `memoryScopes`
- `memoryWorthKeeping`
- `memoryRetrieved`
- `memoryNeededNow`
- `memoryUsedInDecision`
- `memoryImpact`
- `memoryFailureTypes`
- `trajectoryObserved`
- `requiredStepsCovered`
- `unexpectedSteps`
- `toolArgumentsObserved`
- `delegationsObserved`
- `loopCount`
- `graphPath`
- `latencyMs`
- `tokenUsage`
- `langfuseTraceId`

This record is the canonical interface for the evaluation layer.

## 14. Observability and Tracing

Langfuse is the primary observability system.

Trace or span boundaries should include:

- graph node execution
- tool creation
- tool invocation
- retrieval and search operations
- filesystem materialization
- subagent delegation
- feedback application
- memory read and write events
- final evaluation scoring

### Langfuse Responsibilities

- trace storage
- span metadata
- trace-level scores
- span-level scores
- experiment history
- debugging links from benchmark reports

### Local Artifact Responsibilities

The harness should also emit local machine-readable summaries such as JSONL so benchmark runs remain reproducible outside the platform UI.

## 15. Evaluation Strategy

Use deterministic checks first and LLM-as-judge second.

### Metric Families

#### Response Quality Drift

Response quality drift is evaluated as:

`meaningful degradation or change in final task outcome or execution path for the same benchmark scenario across versions, runs, or checkpoints`

Drift has two primary layers:

- `outcome drift`
- `trajectory drift`

Outcome drift is the primary signal.

Measure:

- `outcome_score_delta`
- `domain_correctness_delta`
- `feedback_integration_delta`
- `evidence_grounding_delta`
- `required_findings_recall_delta`
- `escalation_decision_delta`
- `task_success_drift`

Methodology:

- score each run against absolute rubrics
- compare current run to approved baseline run on the same scenario
- use deterministic checks first
- use rubric-based judge scoring where exact matching is too brittle

Count as drift when:

- correctness gets worse
- evidence grounding gets weaker
- feedback is integrated worse
- escalation or disposition quality degrades
- required findings are missed more often

Do not count as drift by itself when:

- wording changes but quality is preserved
- the path changes but the outcome quality is equivalent

#### Context Efficiency

Context efficiency is evaluated as:

`how little context the agent needed to achieve an acceptable result, while avoiding irrelevant, duplicated, stale, or badly structured context`

Correctness gating rule:

- a run must clear the `minimumCorrectnessThreshold` before it can receive a strong context-efficiency score
- a cheap but wrong run is not context-efficient

Primary methodologies:

- `static efficiency scoring`
- `counterfactual efficiency scoring`
  - ablation studies
  - progressive context addition
- `budget-constrained robustness scoring`

Primary rubric dimensions:

- `context sufficiency`
- `context precision`
- `context economy`
- `context structure`
- `context reuse`

Scenario matrix:

1. `minimal sufficient context`
2. `under-context failure`
3. `over-context bloat`
4. `wrong-context retrieval`
5. `duplicate-context waste`
6. `misordered context`
7. `mispartitioned context`
8. `stale or superseded context`
9. `artifact reuse vs regeneration`
10. `budget-constrained prioritization`

Measure:

- `context_precision`
- `context_recall`
- `context_relevance_score`
- `token_to_value_ratio`
- `context_bloat_index`
- `chunk_utilization_rate`
- `minimal_sufficient_context_size`
- `marginal_context_gain`
- `context_saturation_point`
- `critical_context_recall`
- `ablation_loss_per_artifact`
- `ordering_effect_score`
- `context_partition_efficiency`
- `context_inheritance_redundancy`
- `artifact_materialization_efficiency`
- `budget_compliance`
- `success_under_budget`
- `budget_efficiency_score`
- `redundant_retrieval_avoidance`
- `artifact_reuse_rate`
- `duplicate_context_rate`

Primary failure modes:

- `under-context`
- `over-context`
- `wrong-context`
- `duplicate-context`
- `misordered-context`
- `mispartitioned-context`
- `stale-context`
- `unnecessary-context-regeneration`

Recommended weighting after correctness gating:

- `30% context sufficiency`
- `25% context precision`
- `20% context economy`
- `15% context structure`
- `10% context reuse`

#### Memory Utilization

Memory utilization is evaluated as `agentic write/read discipline`, not conversational recall.

Primary evaluation horizons:

- `within-case memory utilization`
- `cross-case memory utilization`

Primary memory sources:

- `trace/tool/file memory`
- `user memory`
- `pattern memory`

Use the following nine-state matrix as the scoring frame:

1. `correct save, correct abstention from retrieval`
2. `correct save, irrelevant retrieval`
3. `missed save, no current harm yet`
4. `correct save, failed needed retrieval`
5. `correct save, correct needed retrieval`
6. `missed save, later needed`
7. `wasteful save, not used`
8. `wasteful save, wrongly used`
9. `correct abstention from saving`

Measure:

- `memory_write_precision`
- `memory_write_recall`
- `memory_abstention_precision`
- `memory_read_precision`
- `memory_read_recall`
- `memory_impact_score`
- `feedback retention`
- `corrected-fact retention`
- `repeat-error reduction across related cases`
- `unnecessary re-retrieval after memory writes`

Penalty categories:

- `irrelevant_retrieval_penalty`
- `missed_needed_retrieval_penalty`
- `missed_needed_write_penalty`
- `wasteful_save_penalty`
- `harmful_memory_activation_penalty`

Diagnostic outputs should also include:

- `memory_hit_rate`
- `artifact_reuse_rate`
- `feedback_carryforward_rate`
- `stale_memory_incidents`
- `negative_transfer_incidents`
- `memory_update_success_rate`

#### Domain Correctness

Measure:

- whether the right issue was identified
- whether the correct policy or control was used
- whether escalation guidance is appropriate
- whether risk is overstated or understated
- whether required red flags were missed

#### Feedback Integration

Measure:

- whether the agent changes behavior after reviewer correction
- whether the correction is preserved in later turns
- whether the updated output is closer to expected policy-compliant behavior

## 16. Trajectory Evaluation

Trajectory drift is the secondary drift signal and should be evaluated explicitly, not treated as a side note.

Use AgentEvals where stable trajectories are meaningful:

- tool creation and tool calling flows for tool-chain scenarios
- node visitation and delegation expectations for workspace scenarios

Evaluation modes can include:

- exact match
- unordered match
- subset or superset match
- rubric-based trajectory judgment

Trajectory drift measures:

- `required_step_coverage_delta`
- `tool_selection_precision_delta`
- `tool_argument_accuracy_delta`
- `unnecessary_step_delta`
- `looping_delta`
- `delegation_alignment_delta`
- `graph_efficiency_delta`

Count as trajectory drift when:

- required steps disappear
- the wrong tools or subagents are selected
- argument binding degrades
- extra low-value steps appear
- loops or repeated steps increase

Do not count as trajectory drift by itself when:

- the step order changes but remains valid
- a shorter path preserves required coverage and outcome quality

## 17. Drift Detection Strategy

Use three benchmark groups:

### PR Smoke Set

- small, cheap, high-signal subset
- intended for fast regression checks

### Release Set

- wider benchmark coverage
- intended for version comparisons and release gating

### Sentinel Drift Set

- stable, representative scenarios rerun regularly
- intended for drift monitoring over time

Drift should be computed in this order:

1. `scenario-level absolute scoring`
2. `scenario-level baseline-relative comparison`
3. `cohort aggregation`
4. `drift classification`

Recommended drift classification:

- `quality-preserving variation`
- `outcome-only drift`
- `trajectory-only drift`
- `combined drift`

Recommended weighting:

- `60% outcome drift`
- `40% trajectory drift`

Aggregate by:

- agent family
- task family
- difficulty
- with feedback versus without feedback
- scenario cohort

Drift should be analyzed by:

- overall score
- task family
- difficulty
- initial run versus feedback-informed run
- token and latency trends
- failure cluster

## 18. TypeScript Implementation Guidance

The implementation should be a single TypeScript codebase on Node 20+.

Recommended stack:

- `pnpm`
- `typescript`
- `langchain`
- `@langchain/langgraph`
- `agentevals`
- `zod`
- `@langfuse/tracing`
- `@langfuse/langchain`
- `@langfuse/client`
- `vitest`
- `tsx`

Why TypeScript is the right fit:

- direct match to the chosen implementation language
- good ecosystem support for LangChain and LangGraph
- strong schema validation with zod
- enough type safety to keep benchmark contracts stable

## 19. Project Structure

```text
src/
  domain/
    scenarios/
    task-families/
    feedback/
    rubrics/
  agents/
    shared/
    tool-chain/
    workspace/
  runtime/
    runner/
    adapters/
    tracing/
    checkpoints/
    artifacts/
  evals/
    contracts/
    metrics/
    judges/
    trajectory/
    drift/
    reporting/
  infra/
    langfuse/
    storage/
    config/
    logging/
datasets/
  benchmark-cases/
  synthetic-packs/
tests/
  unit/
  integration/
  regression/
artifacts/
  runs/
  reports/
  snapshots/
```

## 20. Module Boundaries

### `domain/`

- no LangGraph imports
- no Langfuse imports
- pure scenario and rubric concepts

### `agents/`

- graph definitions
- state types
- provider wiring

### `runtime/`

- scenario execution
- environment materialization
- adapter layer
- artifact handling

### `evals/`

- metric scoring
- drift logic
- judge prompts
- trajectory evaluators

### `infra/`

- Langfuse client wiring
- config loading
- storage and logging utilities

## 21. Error Handling Strategy

Use project-specific exceptions around external failures:

- `ScenarioValidationError`
- `ScenarioMaterializationError`
- `AgentExecutionError`
- `NormalizationError`
- `LangfuseWriteError`
- `MetricComputationError`

The happy path for execution and evaluation should stay readable.

## 22. Risks and Tradeoffs

### Tradeoffs Chosen

- Git-backed benchmark definitions over platform-managed-only datasets
- local runner control over platform-native experiment orchestration
- simple local artifacts before a heavier analytics backend
- one normalized contract for both agent families, even if some fields are sparse per agent type

### Main Risks

- synthetic tasks may drift toward benchmark gaming if not reviewed
- LLM-as-judge components may introduce evaluator instability
- workspace scenarios may become too open-ended without strong artifact expectations
- tool-chain scenarios may overfit to deterministic trajectories if rubric design is weak

### Mitigations

- keep deterministic checks where possible
- use judged metrics only where necessary
- version benchmark cases
- add reviewer audits for benchmark quality
- preserve run artifacts and traces for debugging

## 23. Scaling Triggers

Do not add extra infrastructure early.

Introduce more complexity only when:

- benchmark execution time becomes a bottleneck
- concurrency needs exceed a single process
- JSONL artifacts become painful to aggregate
- trace volume makes local summaries insufficient

Likely future additions:

- worker queue for parallel execution
- stronger report backend
- dedicated analytics store
- richer benchmark authoring tools

## 24. Success Criteria

v1 is successful when:

1. Both agent families can run the same scenario contract.
2. The benchmark covers all four financial compliance task families.
3. Feedback-informed scenarios are scored correctly.
4. Every run produces a Langfuse trace and a normalized record.
5. The harness can detect score regressions across benchmark subsets.
6. The repo remains clean enough for continued benchmark growth.

## 25. Sources

Primary local references:

- `agent_evaluation_research.md`
- `langchain_langgraph_evaluation_addendum.md`

Supporting reference categories used in design:

- system design framework and references
- clean code framework and references
- official LangChain, LangGraph, AgentEvals, and Langfuse documentation

## 26. Follow-On Work

The next document is the implementation plan with milestone ordering, file ownership, and first-pass execution steps.
