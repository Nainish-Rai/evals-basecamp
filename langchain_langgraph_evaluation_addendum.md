# LangChain/LangGraph Agent Evaluation Guide

## Addendum: Specific Implementation for LangChain Ecosystem

---

## Overview

This addendum provides specific implementation guidance for evaluating agents built with **LangChain** and **LangGraph**, leveraging the native evaluation tools in the LangChain ecosystem, particularly **LangSmith** and **AgentEvals**.

---

## Table of Contents

1. [LangSmith Evaluation Platform](#1-langsmith-evaluation-platform)
2. [AgentEvals Package](#2-agentevals-package)
3. [Evaluating Tool Creation + Tool Calling Agents](#3-evaluating-tool-creation--tool-calling-agents)
4. [Evaluating Workspace Agents with Subagents](#4-evaluating-workspace-agents-with-subagents)
5. [LangGraph-Specific Metrics](#5-langgraph-specific-metrics)
6. [Complete Implementation Code](#6-complete-implementation-code)
7. [LangSmith Dataset Creation](#7-langsmith-dataset-creation)
8. [Drift Detection with LangSmith](#8-drift-detection-with-langsmith)

---

## 1. LangSmith Evaluation Platform

### 1.1 Why LangSmith for LangChain/LangGraph Agents?

LangSmith is the **native observability and evaluation platform** for LangChain applications. For agents built with LangChain/LangGraph, it provides:

- **Native Integration**: Zero-configuration tracing for LangGraph agents
- **Automatic Trace Collection**: Every node execution, tool call, and LLM invocation is captured
- **Built-in Evaluators**: Pre-configured LLM-as-Judge, correctness, and custom evaluators
- **Dataset Management**: Version-controlled test datasets
- **Online Evaluation**: Real-time monitoring of production agents
- **Comparative Experiments**: A/B testing different agent configurations

### 1.2 Setting Up LangSmith

```python
import os

# Set environment variables (required for LangSmith tracing)
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-langsmith-api-key"
os.environ["LANGCHAIN_PROJECT"] = "your-project-name"  # Optional: organizes traces

# For LangGraph agents, tracing is automatically enabled when these are set
```

### 1.3 LangSmith Architecture for Agent Evaluation

```
┌─────────────────────────────────────────────────────────────────┐
│                    LangSmith Evaluation Stack                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   LangGraph Agent                                               │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────┐                                              │
│   │   Traces     │ ──▶ Every node, tool call, LLM call logged   │
│   └──────────────┘                                              │
│        │                                                         │
│        ▼                                                         │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │   Dataset    │ ──▶│  Experiment  │ ──▶│  Evaluators  │     │
│   │  (Test Cases)│    │    Run       │    │  (Judges)    │     │
│   └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                  │               │
│                                                  ▼               │
│                                          ┌──────────────┐       │
│                                          │   Feedback   │       │
│                                          │   & Scores   │       │
│                                          └──────────────┘       │
│                                                  │               │
│                                                  ▼               │
│                                          ┌──────────────┐       │
│                                          │   Dashboard  │       │
│                                          │  & Alerts    │       │
│                                          └──────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 Key LangSmith Evaluation Types

| Evaluation Type | Description | Use Case |
|----------------|-------------|----------|
| **Offline Evaluation** | Run against curated datasets | Pre-deployment testing |
| **Online Evaluation** | Real-time trace evaluation | Production monitoring |
| **Trajectory Evaluation** | Assess agent's intermediate steps | Tool selection, reasoning |
| **Pairwise Comparison** | Compare two agent versions | A/B testing |

---

## 2. AgentEvals Package

### 2.1 Overview

**AgentEvals** (`langchain-ai/agentevals`) is the open-source package specifically designed for evaluating agent trajectories. It integrates seamlessly with LangSmith.

**Installation:**
```bash
pip install agentevals
```

### 2.2 Trajectory Evaluation Types

AgentEvals supports three main evaluation modes:

#### 2.2.1 Exact Trajectory Match

```python
from agentevals import TrajectoryMatchEvaluator

evaluator = TrajectoryMatchEvaluator(
    trajectories=[
        {
            "inputs": {"query": "What's the weather in NYC?"},
            "expected_trajectory": [
                {"tool": "get_weather", "args": {"location": "New York City"}},
            ]
        }
    ]
)

result = evaluator.evaluate(agent_trajectory)
# Returns: {"score": 1.0, "passed": True}
```

#### 2.2.2 LLM-as-Judge Trajectory Evaluation

```python
from agentevals import TrajectoryLLMJudge

evaluator = TrajectoryLLMJudge(
    model="gpt-4",
    criteria="""
    Evaluate if the agent's trajectory is efficient and correct:
    1. Were appropriate tools selected?
    2. Were tool arguments correct?
    3. Was the reasoning sound?
    4. Were unnecessary steps avoided?
    """
)

result = evaluator.evaluate(
    inputs={"query": "Compare weather in NYC and LA"},
    trajectory=agent_trace,
)
```

#### 2.2.3 Partial/Ordered Match

```python
from agentevals import TrajectoryUnorderedMatch

evaluator = TrajectoryUnorderedMatch(
    expected_tools=["get_weather", "format_response"],
    allow_extra_steps=True  # Agent can take additional steps
)
```

### 2.3 Graph-Based Trajectory Evaluation

For LangGraph agents, AgentEvals supports graph-based trajectory evaluation:

```python
from agentevals.langgraph import GraphTrajectoryEvaluator

evaluator = GraphTrajectoryEvaluator(
    expected_nodes=["agent", "tools", "should_continue"],
    expected_tools=["search", "calculator"],
    criteria={
        "node_sequence": "partial",  # exact, partial, or unordered
        "tool_correctness": "strict",  # strict or lenient
        "state_transitions": "valid"   # validate state changes
    }
)
```

---

## 3. Evaluating Tool Creation + Tool Calling Agents

### 3.1 Architecture of a Tool Chain Agent

```python
from langgraph.graph import StateGraph, MessagesState
from langchain_core.tools import tool
from typing import TypedDict, Annotated
import operator

class ToolAgentState(TypedDict):
    messages: Annotated[list, operator.add]
    tool_budget: int
    tokens_used: int
    created_tools: list

# Tool Creation Node
def tool_creation_node(state: ToolAgentState):
    """Agent creates tools dynamically based on task"""
    # ... tool creation logic
    return {"created_tools": [new_tool]}

# Tool Calling Node  
def tool_calling_node(state: ToolAgentState):
    """Agent calls tools with budget tracking"""
    # ... tool calling logic with budget check
    return {
        "messages": [response],
        "tool_budget": state["tool_budget"] - 1,
        "tokens_used": state["tokens_used"] + token_count
    }
```

### 3.2 Evaluation Dimensions for Tool Agents

#### 3.2.1 Tool Creation Quality Metrics

```python
from langsmith.schemas import Run, Example
from langsmith.evaluation import evaluate

def evaluate_tool_creation(run: Run, example: Example) -> dict:
    """
    Evaluate the quality of dynamically created tools.
    
    Criteria:
    - Specification completeness
    - Parameter type correctness
    - Documentation quality
    - Error handling design
    """
    created_tools = run.outputs.get("created_tools", [])
    expected_tools = example.outputs.get("expected_tools", [])
    
    scores = {}
    
    # 1. Tool Coverage: Were expected tools created?
    expected_tool_names = {t["name"] for t in expected_tools}
    created_tool_names = {t["name"] for t in created_tools}
    
    scores["tool_coverage"] = len(expected_tool_names & created_tool_names) / len(expected_tool_names)
    
    # 2. Parameter Correctness
    param_scores = []
    for created in created_tools:
        for expected in expected_tools:
            if created["name"] == expected["name"]:
                expected_params = set(expected.get("parameters", {}).keys())
                created_params = set(created.get("parameters", {}).keys())
                if expected_params:
                    param_scores.append(len(expected_params & created_params) / len(expected_params))
    
    scores["parameter_correctness"] = sum(param_scores) / len(param_scores) if param_scores else 0
    
    # 3. Documentation Quality (LLM-as-Judge)
    # ... additional LLM evaluation
    
    return {
        "score": sum(scores.values()) / len(scores),
        "details": scores
    }
```

#### 3.2.2 Tool Calling Efficiency Metrics

```python
def evaluate_tool_calling_efficiency(run: Run, example: Example) -> dict:
    """
    Evaluate tool calling efficiency including budget management.
    """
    # Extract from LangSmith trace
    child_runs = run.child_runs if hasattr(run, 'child_runs') else []
    
    tool_calls = [r for r in child_runs if r.run_type == "tool"]
    llm_calls = [r for r in child_runs if r.run_type == "llm"]
    
    metrics = {}
    
    # 1. Tool Selection Accuracy
    expected_tools = example.outputs.get("expected_tool_calls", [])
    actual_tools = [t.name for t in tool_calls]
    
    correct_selections = sum(
        1 for exp in expected_tools if exp in actual_tools
    )
    metrics["tool_selection_accuracy"] = correct_selections / len(expected_tools) if expected_tools else 0
    
    # 2. Budget Efficiency
    budget_limit = run.inputs.get("tool_budget", float('inf'))
    tools_used = len(tool_calls)
    
    metrics["budget_utilization"] = tools_used / budget_limit if budget_limit > 0 else 0
    metrics["budget_efficiency"] = 1 - max(0, (tools_used - len(expected_tools)) / max(tools_used, 1))
    
    # 3. Token Efficiency
    total_tokens = sum(
        r.outputs.get("token_usage", {}).get("total_tokens", 0) 
        for r in llm_calls
    )
    task_success = run.outputs.get("success", False)
    
    metrics["token_efficiency"] = (1 if task_success else 0) / max(total_tokens / 1000, 1)
    
    return {
        "score": sum(metrics.values()) / len(metrics),
        "details": metrics
    }
```

#### 3.2.3 Multimodal Tool Response Evaluation

```python
def evaluate_multimodal_handling(run: Run, example: Example) -> dict:
    """
    Evaluate how well the agent handles multimodal tool responses.
    """
    outputs = run.outputs or {}
    metrics = {}
    
    # Check for multimodal content in outputs
    multimodal_content = outputs.get("multimodal_content", [])
    
    # 1. Image Processing Quality
    images = [c for c in multimodal_content if c.get("type") == "image"]
    if images:
        # Check if images were properly processed
        metrics["image_processing"] = all(
            img.get("processed", False) and img.get("extracted_text") 
            for img in images
        )
    
    # 2. Audio Processing Quality
    audio = [c for c in multimodal_content if c.get("type") == "audio"]
    if audio:
        metrics["audio_processing"] = all(
            a.get("transcription") and a.get("processed", False)
            for a in audio
        )
    
    # 3. Cross-Modal Reasoning
    # Did the agent correctly combine information from multiple modalities?
    cross_modal_tasks = example.outputs.get("cross_modal_tasks", [])
    if cross_modal_tasks:
        correct_reasoning = sum(
            1 for task in cross_modal_tasks
            if task.get("expected_result") == outputs.get(task.get("key"))
        )
        metrics["cross_modal_reasoning"] = correct_reasoning / len(cross_modal_tasks)
    
    return {
        "score": sum(metrics.values()) / len(metrics) if metrics else 1.0,
        "details": metrics
    }
```

### 3.3 Complete Tool Agent Evaluation Suite

```python
from langsmith import Client
from langsmith.evaluation import evaluate

def create_tool_agent_evaluator():
    """Create comprehensive evaluation suite for tool agents."""
    
    client = Client()
    
    # Define evaluators
    evaluators = [
        # Tool Creation Evaluators
        {
            "evaluator": evaluate_tool_creation,
            "name": "tool_creation_quality",
            "description": "Evaluates the quality of dynamically created tools"
        },
        # Tool Calling Evaluators
        {
            "evaluator": evaluate_tool_calling_efficiency,
            "name": "tool_calling_efficiency",
            "description": "Evaluates tool calling efficiency and budget management"
        },
        # Multimodal Evaluators
        {
            "evaluator": evaluate_multimodal_handling,
            "name": "multimodal_handling",
            "description": "Evaluates handling of multimodal tool responses"
        },
        # Response Quality (LLM-as-Judge)
        {
            "evaluator": "correctness",  # Built-in LangSmith evaluator
            "name": "response_correctness"
        },
        {
            "evaluator": "helpfulness",  # Built-in LangSmith evaluator
            "name": "response_helpfulness"
        }
    ]
    
    return evaluators

# Run evaluation
def run_tool_agent_evaluation(agent, dataset_name: str):
    """Run comprehensive evaluation on tool agent."""
    
    def target(inputs: dict) -> dict:
        """Target function that runs the agent."""
        return agent.invoke(inputs)
    
    results = evaluate(
        target,
        data=dataset_name,
        evaluators=create_tool_agent_evaluator(),
        experiment_prefix="tool-agent-eval"
    )
    
    return results
```

---

## 4. Evaluating Workspace Agents with Subagents

### 4.1 LangGraph Hierarchical Agent Architecture

```python
from langgraph.graph import StateGraph
from langgraph.supervisor import create_supervisor
from typing import TypedDict, List, Any

class WorkspaceAgentState(TypedDict):
    task: str
    subtasks: List[str]
    subagent_assignments: dict
    retrieved_context: dict
    results: List[Any]
    memory_state: dict

# Hierarchical structure using LangGraph Supervisor
def create_workspace_agent():
    """Create a hierarchical workspace agent with subagents."""
    
    # Create supervisor that manages subagents
    supervisor = create_supervisor(
        subagents=[
            # Subagent 1: Context Curation
            {"name": "context_curator", "role": "Retrieves and organizes context from database"},
            # Subagent 2: Task Execution  
            {"name": "task_executor", "role": "Executes specific subtasks"},
            # Subagent 3: Result Aggregator
            {"name": "result_aggregator", "role": "Combines results from multiple subagents"}
        ],
        model="gpt-4",
        # Supervisor decides which subagent to use
        supervisor_prompt="""You are a workspace manager. 
        Given a task, decompose it and delegate to appropriate subagents.
        Coordinate the results and provide a final answer."""
    )
    
    return supervisor.compile()
```

### 4.2 Evaluation Dimensions for Workspace Agents

#### 4.2.1 Subagent Coordination Quality

```python
def evaluate_subagent_coordination(run: Run, example: Example) -> dict:
    """
    Evaluate how well subagents are coordinated.
    
    Metrics:
    - Task decomposition quality
    - Subagent selection accuracy
    - Communication efficiency
    - Result aggregation quality
    """
    metrics = {}
    
    # Parse the trace for subagent calls
    child_runs = run.child_runs if hasattr(run, 'child_runs') else []
    subagent_calls = [
        r for r in child_runs 
        if r.name in ["context_curator", "task_executor", "result_aggregator"]
    ]
    
    # 1. Task Decomposition Quality
    expected_subtasks = example.outputs.get("expected_subtasks", [])
    actual_subtasks = run.outputs.get("subtasks", [])
    
    if expected_subtasks:
        # Check coverage of expected subtasks
        covered = sum(
            1 for exp in expected_subtasks 
            if any(exp.lower() in actual.lower() for actual in actual_subtasks)
        )
        metrics["decomposition_coverage"] = covered / len(expected_subtasks)
    
    # 2. Subagent Selection Accuracy
    expected_assignments = example.outputs.get("expected_subagent_assignments", {})
    actual_assignments = run.outputs.get("subagent_assignments", {})
    
    if expected_assignments:
        correct_assignments = sum(
            1 for task, agent in expected_assignments.items()
            if actual_assignments.get(task) == agent
        )
        metrics["selection_accuracy"] = correct_assignments / len(expected_assignments)
    
    # 3. Communication Overhead
    # Measure inter-agent communication messages
    communication_messages = [
        r for r in child_runs 
        if r.run_type == "chain" and "communication" in r.name.lower()
    ]
    
    expected_communication = example.outputs.get("expected_communication_count", 5)
    actual_communication = len(communication_messages)
    
    # Lower is better, but needs sufficient communication
    metrics["communication_efficiency"] = max(0, 1 - (actual_communication - expected_communication) / max(expected_communication, 1))
    
    # 4. Result Aggregation Quality
    final_result = run.outputs.get("result", "")
    expected_result = example.outputs.get("expected_result", "")
    
    # Use semantic similarity for aggregation quality
    metrics["aggregation_quality"] = calculate_semantic_similarity(final_result, expected_result)
    
    return {
        "score": sum(metrics.values()) / len(metrics) if metrics else 0,
        "details": metrics
    }
```

#### 4.2.2 Context Curation Efficiency

```python
def evaluate_context_curation(run: Run, example: Example) -> dict:
    """
    Evaluate the efficiency of database-to-filesystem context curation.
    
    Metrics:
    - Retrieval precision/recall
    - Context organization quality
    - Token efficiency
    - Filesystem structure quality
    """
    metrics = {}
    
    # Get context curation trace
    child_runs = run.child_runs if hasattr(run, 'child_runs') else []
    retrieval_runs = [r for r in child_runs if "retrieval" in r.name.lower()]
    
    # 1. Retrieval Precision
    retrieved_docs = []
    for r in retrieval_runs:
        if r.outputs:
            retrieved_docs.extend(r.outputs.get("documents", []))
    
    relevant_docs = example.outputs.get("relevant_documents", [])
    if retrieved_docs and relevant_docs:
        relevant_retrieved = sum(
            1 for doc in retrieved_docs
            if any(ref in doc for ref in relevant_docs)
        )
        metrics["retrieval_precision"] = relevant_retrieved / len(retrieved_docs)
        metrics["retrieval_recall"] = relevant_retrieved / len(relevant_docs)
    
    # 2. Context Token Efficiency
    total_context_tokens = sum(
        r.outputs.get("token_count", 0) 
        for r in retrieval_runs
    )
    essential_tokens = example.outputs.get("essential_token_count", total_context_tokens * 0.5)
    
    if total_context_tokens > 0:
        metrics["token_efficiency"] = essential_tokens / total_context_tokens
    
    # 3. Filesystem Organization Quality
    filesystem_structure = run.outputs.get("filesystem_structure", {})
    expected_structure = example.outputs.get("expected_filesystem_structure", {})
    
    if expected_structure:
        # Check if organization matches expected pattern
        org_match_score = compare_structures(filesystem_structure, expected_structure)
        metrics["organization_quality"] = org_match_score
    
    return {
        "score": sum(metrics.values()) / len(metrics) if metrics else 0,
        "details": metrics
    }
```

#### 4.2.3 Memory Management Across Agents

```python
def evaluate_memory_utilization(run: Run, example: Example) -> dict:
    """
    Evaluate memory utilization across the multi-agent system.
    
    Metrics:
    - Memory state persistence
    - Cross-agent memory consistency
    - Memory access patterns
    - Checkpoint efficiency
    """
    metrics = {}
    
    # Get memory state from run
    memory_state = run.outputs.get("memory_state", {})
    
    # 1. Memory Persistence Score
    # Check if important information was persisted
    expected_memories = example.outputs.get("expected_memories", [])
    persisted_memories = memory_state.get("persisted", [])
    
    if expected_memories:
        persisted_count = sum(
            1 for mem in expected_memories
            if any(mem.lower() in pm.lower() for pm in persisted_memories)
        )
        metrics["memory_persistence"] = persisted_count / len(expected_memories)
    
    # 2. Cross-Agent Memory Consistency
    # Check if subagents have consistent view of memory
    subagent_memories = memory_state.get("subagent_memories", {})
    if subagent_memories:
        # Compare memory states across agents
        memory_values = list(subagent_memories.values())
        if len(memory_values) > 1:
            # Calculate consistency score
            consistency_scores = []
            for i, m1 in enumerate(memory_values[:-1]):
                for m2 in memory_values[i+1:]:
                    consistency_scores.append(
                        calculate_memory_consistency(m1, m2)
                    )
            metrics["cross_agent_consistency"] = sum(consistency_scores) / len(consistency_scores)
    
    # 3. Checkpoint Efficiency
    checkpoint_runs = [
        r for r in (run.child_runs if hasattr(run, 'child_runs') else [])
        if "checkpoint" in r.name.lower()
    ]
    
    if checkpoint_runs:
        # Checkpoint size vs value
        total_checkpoint_size = sum(
            r.outputs.get("size_bytes", 0) 
            for r in checkpoint_runs
        )
        # Smaller checkpoints with same information = more efficient
        metrics["checkpoint_efficiency"] = 1 / max(total_checkpoint_size / 1000, 1)
    
    return {
        "score": sum(metrics.values()) / len(metrics) if metrics else 0,
        "details": metrics
    }
```

---

## 5. LangGraph-Specific Metrics

### 5.1 Graph Execution Metrics

LangGraph agents have unique evaluation opportunities due to their graph-based architecture:

```python
def evaluate_graph_execution(run: Run, example: Example) -> dict:
    """
    Evaluate LangGraph-specific execution patterns.
    
    Metrics:
    - Node visit patterns
    - Edge transition correctness
    - State evolution quality
    - Cycle detection (unnecessary loops)
    """
    metrics = {}
    
    # Extract graph execution trace
    graph_trace = run.outputs.get("graph_trace", {})
    node_visits = graph_trace.get("node_visits", [])
    edge_transitions = graph_trace.get("edge_transitions", [])
    
    # 1. Node Visit Efficiency
    expected_nodes = example.outputs.get("expected_nodes", [])
    expected_visits = len(expected_nodes)
    actual_visits = len(node_visits)
    
    # Penalize unnecessary revisits
    if actual_visits > 0:
        metrics["node_efficiency"] = min(1, expected_visits / actual_visits)
    
    # 2. Edge Transition Correctness
    expected_transitions = example.outputs.get("expected_transitions", [])
    if expected_transitions:
        correct_transitions = sum(
            1 for exp in expected_transitions
            if exp in edge_transitions
        )
        metrics["transition_correctness"] = correct_transitions / len(expected_transitions)
    
    # 3. State Evolution Quality
    state_history = graph_trace.get("state_history", [])
    if len(state_history) > 1:
        # Check if state is progressing towards goal
        goal_state = example.outputs.get("goal_state", {})
        progression_scores = []
        
        for state in state_history:
            # Measure progress towards goal
            progression_scores.append(
                calculate_state_progress(state, goal_state)
            )
        
        # State should generally progress (monotonically or with slight dips)
        metrics["state_progression"] = progression_scores[-1] if progression_scores else 0
    
    # 4. Cycle Detection
    # Detect if agent got stuck in loops
    unique_paths = set()
    cycles_detected = 0
    
    for i, visit in enumerate(node_visits):
        path_key = f"{visit['node']}_{visit.get('state_hash', i)}"
        if path_key in unique_paths:
            cycles_detected += 1
        unique_paths.add(path_key)
    
    metrics["cycle_penalty"] = max(0, 1 - cycles_detected / max(len(node_visits), 1))
    
    return {
        "score": sum(metrics.values()) / len(metrics) if metrics else 0,
        "details": metrics
    }
```

### 5.2 LangGraph Checkpoint Memory Evaluation

```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver

def evaluate_checkpoint_memory(agent, test_cases: list) -> dict:
    """
    Evaluate LangGraph's checkpoint-based memory system.
    
    Tests:
    - State persistence across invocations
    - Thread isolation
    - Checkpoint recovery
    - Memory size efficiency
    """
    results = {
        "persistence_score": 0,
        "isolation_score": 0,
        "recovery_score": 0,
        "efficiency_score": 0
    }
    
    # Test with different checkpointers
    checkpointer = MemorySaver()
    
    # 1. Persistence Test
    thread_id = "test-thread-1"
    
    # First invocation
    state1 = agent.invoke(
        {"messages": [("user", "Remember: my favorite color is blue")]},
        config={"configurable": {"thread_id": thread_id}},
        checkpointer=checkpointer
    )
    
    # Second invocation - should remember
    state2 = agent.invoke(
        {"messages": [("user", "What's my favorite color?")]},
        config={"configurable": {"thread_id": thread_id}},
        checkpointer=checkpointer
    )
    
    # Check if memory persisted
    if "blue" in str(state2).lower():
        results["persistence_score"] = 1.0
    
    # 2. Thread Isolation Test
    thread_id_2 = "test-thread-2"
    state3 = agent.invoke(
        {"messages": [("user", "What's my favorite color?")]},
        config={"configurable": {"thread_id": thread_id_2}},
        checkpointer=checkpointer
    )
    
    # Should NOT remember from thread 1
    if "blue" not in str(state3).lower():
        results["isolation_score"] = 1.0
    
    # 3. Checkpoint Recovery Test
    checkpoint_tuple = checkpointer.get_tuple({"thread_id": thread_id})
    if checkpoint_tuple:
        # Restore from checkpoint
        restored_state = agent.invoke(
            {"messages": [("user", "Continue from where we left off")]},
            config={"configurable": {"thread_id": thread_id}},
            checkpointer=checkpointer
        )
        results["recovery_score"] = 1.0
    
    # 4. Memory Size Efficiency
    # Get checkpoint size
    checkpoint_size = len(str(checkpoint_tuple.checkpoint)) if checkpoint_tuple else 0
    # Compare to baseline
    baseline_size = 1000  # Expected baseline in characters
    results["efficiency_score"] = min(1, baseline_size / max(checkpoint_size, 1))
    
    return results
```

---

## 6. Complete Implementation Code

### 6.1 Full Evaluation Framework

```python
"""
Complete LangChain/LangGraph Agent Evaluation Framework
========================================================
"""

import os
from typing import Dict, List, Any, Optional
from datetime import datetime

from langsmith import Client
from langsmith.evaluation import evaluate
from langsmith.schemas import Run, Example

# Environment setup
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-api-key"

class LangGraphAgentEvaluator:
    """
    Comprehensive evaluation framework for LangGraph agents.
    Supports both Tool Chain agents and Workspace agents with subagents.
    """
    
    def __init__(
        self,
        project_name: str,
        agent_type: str = "tool_chain",  # "tool_chain" or "workspace"
        langsmith_api_key: Optional[str] = None
    ):
        self.project_name = project_name
        self.agent_type = agent_type
        
        if langsmith_api_key:
            os.environ["LANGCHAIN_API_KEY"] = langsmith_api_key
        
        self.client = Client()
        self.baseline_results = None
        
    def create_dataset(
        self,
        dataset_name: str,
        test_cases: List[Dict],
        description: str = ""
    ) -> str:
        """
        Create a LangSmith dataset from test cases.
        
        Args:
            dataset_name: Name for the dataset
            test_cases: List of test case dictionaries
            description: Dataset description
            
        Returns:
            Dataset identifier
        """
        # Create dataset
        dataset = self.client.create_dataset(
            dataset_name=dataset_name,
            description=description
        )
        
        # Add examples
        for case in test_cases:
            self.client.create_example(
                inputs=case["inputs"],
                outputs=case.get("outputs", {}),
                dataset_id=dataset.id,
                metadata=case.get("metadata", {})
            )
        
        return dataset.id
    
    def _get_evaluators(self) -> List[Dict]:
        """Get appropriate evaluators based on agent type."""
        
        if self.agent_type == "tool_chain":
            return [
                {"evaluator": self._eval_tool_creation, "name": "tool_creation"},
                {"evaluator": self._eval_tool_calling, "name": "tool_calling"},
                {"evaluator": self._eval_multimodal, "name": "multimodal"},
                {"evaluator": self._eval_budget, "name": "budget_management"},
                {"evaluator": self._eval_response_quality, "name": "response_quality"},
            ]
        else:  # workspace agent
            return [
                {"evaluator": self._eval_subagent_coord, "name": "subagent_coordination"},
                {"evaluator": self._eval_context_curation, "name": "context_curation"},
                {"evaluator": self._eval_memory, "name": "memory_utilization"},
                {"evaluator": self._eval_response_quality, "name": "response_quality"},
            ]
    
    def run_evaluation(
        self,
        agent,
        dataset_name: str,
        experiment_name: Optional[str] = None
    ) -> Dict:
        """
        Run comprehensive evaluation.
        
        Args:
            agent: The LangGraph agent to evaluate
            dataset_name: Name of the LangSmith dataset
            experiment_name: Optional experiment name prefix
            
        Returns:
            Evaluation results dictionary
        """
        
        def target(inputs: dict) -> dict:
            """Target function for evaluation."""
            return agent.invoke(inputs)
        
        # Run evaluation
        results = evaluate(
            target,
            data=dataset_name,
            evaluators=self._get_evaluators(),
            experiment_prefix=experiment_name or f"{self.project_name}-eval"
        )
        
        return results
    
    def detect_drift(
        self,
        current_results: Dict,
        threshold: float = 0.1
    ) -> Dict:
        """
        Detect drift by comparing current results to baseline.
        
        Args:
            current_results: Latest evaluation results
            threshold: Drift detection threshold
            
        Returns:
            Drift analysis report
        """
        if self.baseline_results is None:
            self.baseline_results = current_results
            return {"status": "baseline_set", "drift_detected": False}
        
        drift_report = {
            "timestamp": datetime.now().isoformat(),
            "drift_detected": False,
            "metrics": {}
        }
        
        for metric in self._get_evaluators():
            metric_name = metric["name"]
            baseline = self.baseline_results.get(metric_name, 0)
            current = current_results.get(metric_name, 0)
            
            drift = abs(current - baseline)
            drift_report["metrics"][metric_name] = {
                "baseline": baseline,
                "current": current,
                "drift": drift,
                "exceeds_threshold": drift > threshold
            }
            
            if drift > threshold:
                drift_report["drift_detected"] = True
        
        return drift_report
    
    # Evaluation methods for Tool Chain agents
    def _eval_tool_creation(self, run: Run, example: Example) -> dict:
        """Evaluate tool creation quality."""
        # Implementation from Section 3.2.1
        return evaluate_tool_creation(run, example)
    
    def _eval_tool_calling(self, run: Run, example: Example) -> dict:
        """Evaluate tool calling efficiency."""
        return evaluate_tool_calling_efficiency(run, example)
    
    def _eval_multimodal(self, run: Run, example: Example) -> dict:
        """Evaluate multimodal handling."""
        return evaluate_multimodal_handling(run, example)
    
    def _eval_budget(self, run: Run, example: Example) -> dict:
        """Evaluate budget management."""
        # Extract budget metrics from trace
        metrics = {}
        
        child_runs = run.child_runs if hasattr(run, 'child_runs') else []
        tool_calls = [r for r in child_runs if r.run_type == "tool"]
        
        budget_limit = run.inputs.get("tool_budget", float('inf'))
        tools_used = len(tool_calls)
        
        metrics["budget_compliance"] = 1.0 if tools_used <= budget_limit else 0.0
        metrics["budget_utilization"] = tools_used / budget_limit if budget_limit > 0 else 0
        
        return {"score": sum(metrics.values()) / len(metrics), "details": metrics}
    
    # Evaluation methods for Workspace agents
    def _eval_subagent_coord(self, run: Run, example: Example) -> dict:
        """Evaluate subagent coordination."""
        return evaluate_subagent_coordination(run, example)
    
    def _eval_context_curation(self, run: Run, example: Example) -> dict:
        """Evaluate context curation efficiency."""
        return evaluate_context_curation(run, example)
    
    def _eval_memory(self, run: Run, example: Example) -> dict:
        """Evaluate memory utilization."""
        return evaluate_memory_utilization(run, example)
    
    # Shared evaluation methods
    def _eval_response_quality(self, run: Run, example: Example) -> dict:
        """Evaluate final response quality using LLM-as-Judge."""
        from langsmith.evaluation import LangChainStringEvaluator
        
        evaluator = LangChainStringEvaluator(
            "score",
            config={
                "criteria": """
                Score the response on:
                1. Correctness: Is the answer factually correct?
                2. Helpfulness: Does it address the user's need?
                3. Clarity: Is it easy to understand?
                4. Completeness: Does it cover all aspects?
                """,
                "scale": [1, 5]
            }
        )
        
        result = evaluator.evaluate_strings(
            prediction=run.outputs.get("response", ""),
            reference=example.outputs.get("expected_response", ""),
            input=example.inputs.get("query", "")
        )
        
        return {"score": result["score"] / 5, "details": result}
```

### 6.2 Test Query Dataset Generator

```python
"""
LangSmith Dataset Generator for Agent Evaluation
================================================
"""

from langsmith import Client
from typing import List, Dict
import json

class AgentDatasetGenerator:
    """
    Generate synthetic test datasets for agent evaluation.
    Integrates with LangSmith for dataset management.
    """
    
    def __init__(self, llm_client, agent_type: str):
        """
        Args:
            llm_client: LLM client for synthetic generation
            agent_type: "tool_chain" or "workspace"
        """
        self.llm = llm_client
        self.agent_type = agent_type
        self.langsmith_client = Client()
    
    def generate_tool_chain_dataset(
        self,
        n_tasks: int = 100,
        difficulty_distribution: Dict = None
    ) -> List[Dict]:
        """
        Generate test cases for Tool Chain agents.
        
        Categories:
        - Simple tool creation
        - Complex tool orchestration
        - Multimodal tool responses
        - Budget-constrained tasks
        - Error recovery scenarios
        """
        if difficulty_distribution is None:
            difficulty_distribution = {"easy": 0.3, "medium": 0.5, "hard": 0.2}
        
        categories = [
            "simple_tool_creation",
            "complex_orchestration",
            "multimodal_response",
            "budget_constrained",
            "error_recovery"
        ]
        
        test_cases = []
        
        for difficulty, proportion in difficulty_distribution.items():
            n = int(n_tasks * proportion)
            
            for _ in range(n):
                category = self._select_category(categories, difficulty)
                test_case = self._generate_single_task(difficulty, category)
                test_cases.append(test_case)
        
        return test_cases
    
    def generate_workspace_dataset(
        self,
        n_tasks: int = 100,
        difficulty_distribution: Dict = None
    ) -> List[Dict]:
        """
        Generate test cases for Workspace agents with subagents.
        
        Categories:
        - Context curation
        - Subagent delegation
        - Multi-database integration
        - Long-running workflows
        """
        if difficulty_distribution is None:
            difficulty_distribution = {"easy": 0.3, "medium": 0.5, "hard": 0.2}
        
        categories = [
            "context_curation",
            "subagent_delegation",
            "multi_database",
            "long_workflow"
        ]
        
        test_cases = []
        
        for difficulty, proportion in difficulty_distribution.items():
            n = int(n_tasks * proportion)
            
            for _ in range(n):
                category = self._select_category(categories, difficulty)
                test_case = self._generate_workspace_task(difficulty, category)
                test_cases.append(test_case)
        
        return test_cases
    
    def _generate_single_task(self, difficulty: str, category: str) -> Dict:
        """Generate a single test case using LLM."""
        
        prompt = f"""
        Generate a {difficulty} test case for an AI agent with tool creation and calling capabilities.
        
        Category: {category}
        
        Output JSON format:
        {{
            "inputs": {{
                "query": "<user task description>",
                "tool_budget": <max tools that can be called>,
                "token_budget": <max tokens allowed>
            }},
            "outputs": {{
                "expected_tools": ["list of tools that should be created"],
                "expected_tool_calls": ["list of tools that should be called"],
                "expected_response": "<expected final response>",
                "expected_trajectory": ["step1", "step2", ...]
            }},
            "metadata": {{
                "difficulty": "{difficulty}",
                "category": "{category}",
                "evaluation_criteria": ["criterion1", "criterion2", ...]
            }}
        }}
        
        Make the test case realistic and challenging for a {difficulty} level.
        """
        
        response = self.llm.invoke(prompt)
        return json.loads(response.content)
    
    def _generate_workspace_task(self, difficulty: str, category: str) -> Dict:
        """Generate a workspace agent test case."""
        
        prompt = f"""
        Generate a {difficulty} test case for a workspace AI agent that:
        - Spins up subagents to handle different tasks
        - Curates context from databases into a filesystem
        - Coordinates multiple smaller model subagents
        
        Category: {category}
        
        Output JSON format:
        {{
            "inputs": {{
                "query": "<user task description>",
                "available_databases": ["db1", "db2", ...],
                "filesystem_root": "<root path for context curation>"
            }},
            "outputs": {{
                "expected_subtasks": ["task1", "task2", ...],
                "expected_subagent_assignments": {{"task1": "subagent1", ...}},
                "expected_retrieved_documents": ["doc1", "doc2", ...],
                "expected_filesystem_structure": {{"folder1": ["file1", ...], ...}},
                "expected_response": "<expected final response>"
            }},
            "metadata": {{
                "difficulty": "{difficulty}",
                "category": "{category}",
                "evaluation_criteria": ["criterion1", "criterion2", ...]
            }}
        }}
        
        Make the test case realistic and challenging for a {difficulty} level.
        """
        
        response = self.llm.invoke(prompt)
        return json.loads(response.content)
    
    def upload_to_langsmith(
        self,
        test_cases: List[Dict],
        dataset_name: str,
        description: str = ""
    ):
        """Upload generated test cases to LangSmith."""
        
        dataset = self.langsmith_client.create_dataset(
            dataset_name=dataset_name,
            description=description
        )
        
        for case in test_cases:
            self.langsmith_client.create_example(
                inputs=case["inputs"],
                outputs=case.get("outputs", {}),
                dataset_id=dataset.id,
                metadata=case.get("metadata", {})
            )
        
        return dataset.id
```

---

## 7. LangSmith Dataset Creation

### 7.1 Creating Datasets from Production Traces

```python
from langsmith import Client

def create_dataset_from_production_traces(
    project_name: str,
    dataset_name: str,
    filter_criteria: Dict = None
):
    """
    Create evaluation dataset from production agent traces.
    
    This is a best practice for creating realistic test cases:
    1. Collect traces from production
    2. Filter for interesting/edge cases
    3. Add human-verified expected outputs
    4. Version the dataset
    """
    client = Client()
    
    # Get traces from production project
    traces = client.list_runs(
        project_name=project_name,
        run_type="chain",
        filter=filter_criteria
    )
    
    # Create dataset
    dataset = client.create_dataset(
        dataset_name=dataset_name,
        description=f"Created from production traces in {project_name}"
    )
    
    # Convert traces to examples
    for trace in traces:
        # Filter for failed or interesting cases
        if trace.error or trace.feedback_stats:
            client.create_example(
                inputs=trace.inputs,
                outputs={},  # Human will fill in expected outputs
                dataset_id=dataset.id,
                metadata={
                    "source_run_id": str(trace.id),
                    "had_error": trace.error is not None,
                    "original_outputs": trace.outputs
                }
            )
    
    return dataset.id
```

### 7.2 Dataset Versioning and Management

```python
def manage_dataset_versions(
    dataset_name: str,
    operation: str = "list"
):
    """
    Manage dataset versions in LangSmith.
    
    Operations:
    - list: List all versions
    - create: Create new version snapshot
    - compare: Compare two versions
    """
    client = Client()
    
    if operation == "list":
        # List all examples with their versions
        examples = client.list_examples(dataset_name=dataset_name)
        versions = {}
        for ex in examples:
            version = ex.metadata.get("version", "unversioned")
            versions[version] = versions.get(version, 0) + 1
        return versions
    
    elif operation == "create":
        # Tag current state as a version
        import uuid
        version_tag = f"v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        examples = client.list_examples(dataset_name=dataset_name)
        for ex in examples:
            client.update_example(
                example_id=ex.id,
                metadata={**ex.metadata, "version": version_tag}
            )
        return version_tag
```

---

## 8. Drift Detection with LangSmith

### 8.1 Online Drift Detection

```python
from langsmith import Client
import numpy as np
from datetime import datetime, timedelta

class LangSmithDriftDetector:
    """
    Drift detection using LangSmith's online evaluation capabilities.
    """
    
    def __init__(
        self,
        project_name: str,
        baseline_period_days: int = 7
    ):
        self.client = Client()
        self.project_name = project_name
        self.baseline_period = timedelta(days=baseline_period_days)
    
    def compute_baseline(self) -> Dict:
        """Compute baseline metrics from historical runs."""
        
        end_time = datetime.now()
        start_time = end_time - self.baseline_period
        
        # Get runs from baseline period
        runs = list(self.client.list_runs(
            project_name=self.project_name,
            start_time=start_time,
            end_time=end_time
        ))
        
        baseline = {
            "success_rate": np.mean([1 for r in runs if not r.error]),
            "avg_latency": np.mean([r.total_tokens or 0 for r in runs]),
            "avg_tokens": np.mean([
                sum(r.prompt_tokens or 0, r.completion_tokens or 0)
                for r in runs
            ]),
            "period": f"{start_time.date()} to {end_time.date()}"
        }
        
        return baseline
    
    def detect_drift(
        self,
        comparison_period_hours: int = 24,
        thresholds: Dict = None
    ) -> Dict:
        """
        Detect drift by comparing recent performance to baseline.
        
        Args:
            comparison_period_hours: Hours of recent data to compare
            thresholds: Dict of metric -> threshold pairs
        """
        if thresholds is None:
            thresholds = {
                "success_rate": 0.1,  # 10% drop
                "avg_latency": 0.2,   # 20% increase
                "avg_tokens": 0.3     # 30% increase
            }
        
        baseline = self.compute_baseline()
        
        # Get recent runs
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=comparison_period_hours)
        
        recent_runs = list(self.client.list_runs(
            project_name=self.project_name,
            start_time=start_time,
            end_time=end_time
        ))
        
        current = {
            "success_rate": np.mean([1 for r in recent_runs if not r.error]),
            "avg_latency": np.mean([r.total_tokens or 0 for r in recent_runs]),
            "avg_tokens": np.mean([
                sum(r.prompt_tokens or 0, r.completion_tokens or 0)
                for r in recent_runs
            ])
        }
        
        # Compute drift
        drift_report = {
            "timestamp": datetime.now().isoformat(),
            "drift_detected": False,
            "metrics": {}
        }
        
        for metric, threshold in thresholds.items():
            baseline_val = baseline.get(metric, 0)
            current_val = current.get(metric, 0)
            
            if baseline_val > 0:
                relative_change = abs(current_val - baseline_val) / baseline_val
                
                drift_report["metrics"][metric] = {
                    "baseline": baseline_val,
                    "current": current_val,
                    "relative_change": relative_change,
                    "exceeds_threshold": relative_change > threshold
                }
                
                if relative_change > threshold:
                    drift_report["drift_detected"] = True
        
        return drift_report
    
    def setup_online_evaluators(self):
        """
        Set up LangSmith online evaluators for continuous drift detection.
        """
        # Configure online evaluators in LangSmith
        evaluators_config = [
            {
                "name": "response_quality",
                "type": "llm_as_judge",
                "config": {
                    "model": "gpt-4",
                    "criteria": "Evaluate response quality on correctness, helpfulness, clarity",
                    "scale": [1, 5]
                }
            },
            {
                "name": "trajectory_efficiency",
                "type": "code_based",
                "config": {
                    "script": "evaluate_trajectory_efficiency"
                }
            }
        ]
        
        # In LangSmith UI, these would be configured via the Tracing Projects tab
        return evaluators_config
```

### 8.2 Automated Alerting

```python
def setup_drift_alerts(
    project_name: str,
    alert_webhook: str = None,
    email_recipients: List[str] = None
):
    """
    Set up automated drift alerts.
    
    Integrates with:
    - Slack webhooks
    - Email notifications
    - PagerDuty for critical alerts
    """
    detector = LangSmithDriftDetector(project_name)
    
    # Continuous monitoring function (would be deployed as a cron job or cloud function)
    def check_and_alert():
        drift_report = detector.detect_drift()
        
        if drift_report["drift_detected"]:
            alert_message = f"""
            🚨 **Drift Detected in {project_name}**
            
            Timestamp: {drift_report['timestamp']}
            
            Affected Metrics:
            """
            
            for metric, details in drift_report["metrics"].items():
                if details["exceeds_threshold"]:
                    alert_message += f"""
                    - **{metric}**: {details['relative_change']:.1%} change
                      Baseline: {details['baseline']:.2f}
                      Current: {details['current']:.2f}
                    """
            
            # Send alerts
            if alert_webhook:
                import requests
                requests.post(alert_webhook, json={"text": alert_message})
            
            if email_recipients:
                # Send email via your email service
                pass
        
        return drift_report
    
    return check_and_alert
```

---

## 9. Quick Reference: LangChain/LangGraph Evaluation Stack

### Recommended Tool Stack

| Evaluation Need | LangChain Tool | Alternative |
|----------------|----------------|-------------|
| **Tracing & Observability** | LangSmith | Langfuse, Arize Phoenix |
| **Trajectory Evaluation** | AgentEvals | Custom + LangSmith |
| **LLM-as-Judge** | LangSmith Evaluators | OpenEvals |
| **Dataset Management** | LangSmith Datasets | Custom + version control |
| **Drift Detection** | LangSmith Online Eval | Evidently AI |
| **Memory Testing** | LangGraph Checkpoints + Custom | LOCOMO benchmark |
| **Budget Tracking** | Custom (State-based) | AgentBudget.dev |

### Key LangSmith API Endpoints

```python
from langsmith import Client

client = Client()

# Dataset operations
client.create_dataset(name="...", description="...")
client.create_example(inputs={...}, outputs={...}, dataset_id=...)
client.list_examples(dataset_name="...")

# Run operations  
client.list_runs(project_name="...")
client.read_run(run_id="...")

# Evaluation
client.create_feedback(run_id="...", key="...", score=...)
client.list_feedback(run_ids=[...])

# Annotations
client.annotate_run(run_id="...", feedback={...})
```

### LangGraph-Specific Best Practices

1. **Use State for Tracking Metrics**
   ```python
   class AgentState(TypedDict):
       # ... other fields
       token_count: int
       tool_call_count: int
       budget_remaining: float
   ```

2. **Leverage Checkpointers for Memory Evaluation**
   ```python
   from langgraph.checkpoint.memory import MemorySaver
   
   checkpointer = MemorySaver()
   # Checkpoints automatically save state for memory evaluation
   ```

3. **Use LangGraph's Built-in Middleware for Token Tracking**
   ```python
   from langgraph.middleware import TokenTrackingMiddleware
   
   graph.add_middleware(TokenTrackingMiddleware())
   ```

4. **Structure Graph for Evaluation Clarity**
   ```python
   # Use meaningful node names for easier trajectory evaluation
   graph.add_node("tool_creation", tool_creation_node)
   graph.add_node("tool_selection", tool_selection_node)
   graph.add_node("execution", execution_node)
   ```

---

## 10. Summary

For agents built with **LangChain and LangGraph**, the evaluation strategy should center on:

### For Tool Creation + Tool Calling Agents:
1. **LangSmith** for tracing and evaluation orchestration
2. **AgentEvals** for trajectory evaluation
3. **Custom evaluators** for tool creation quality
4. **State-based budget tracking** in LangGraph

### For Workspace Agents with Subagents:
1. **LangSmith** for hierarchical trace analysis
2. **Custom evaluators** for subagent coordination
3. **LangGraph checkpointers** for memory evaluation
4. **State inspection** for context curation efficiency

### Key Integration Points:
- LangSmith automatically captures all LangGraph node executions
- AgentEvals integrates with LangSmith datasets
- Online evaluators provide continuous drift detection
- Datasets can be created from production traces for realistic testing

---

*This addendum complements the main research document with specific LangChain/LangGraph implementation guidance.*
