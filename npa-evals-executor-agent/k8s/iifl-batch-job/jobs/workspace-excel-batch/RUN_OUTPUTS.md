# Run Output Mapping Guide

This guide explains how to map downloaded batch output folders back to the original Excel rows/tasks.

## Two storage trees

There are two different output trees:

### 1. Artifact tree

This contains only generated deliverables.

Example:

```text
research-platform-bucket/workspace-agent/full-sonnet-safe-b1-1774181127-root/<run_id>/artifacts/...
research-platform-bucket/workspace-agent/full-sonnet-safe-b1-1774181127-root/<run_id>/analysis/...
```

What you will see here:

- `artifacts/`
- `analysis/`

What you will not see here:

- `metadata/prompt.txt`
- `logs/run.log`
- `summary.json`
- `events.json`

### 2. Trace tree

This contains run metadata and trace files.

Per-run trace path:

```text
workspace-agent-traces-private/workspace-agent-traces/full-sonnet-safe-b1-1774181127-root/<run_id>/summary.json
workspace-agent-traces-private/workspace-agent-traces/full-sonnet-safe-b1-1774181127-root/<run_id>/events.json
workspace-agent-traces-private/workspace-agent-traces/full-sonnet-safe-b1-1774181127-root/<run_id>/final_answer.md
```

Per-batch trace path:

```text
workspace-agent-traces-private/workspace-agent-traces/batches/full-sonnet-safe-b1-1774181127/summary.json
```

## What each folder means

### Batch folder

Example:

```text
full-sonnet-safe-b23-1774181127-root
```

This identifies one batch.

From the scheduler status, that batch maps to a row range:

- `row_start`
- `row_end`

Example:

- `full-sonnet-safe-b23-1774181127-root` -> Excel rows `442-461`

### Run folder

Inside each batch root, each run-id folder is one Excel row/task.

Example:

```text
full-sonnet-safe-b1-1774181127-root/0dbce868-f6bc-4e07-9a85-9167dc917283
```

That one `run_id` corresponds to one row from the Excel.

## Best way to map a run back to the Excel row

### Option 1: Use per-run `summary.json`

This is the best source.

It contains:

- `run_id`
- `question`
- `duration_seconds`
- `usage`
- `artifacts`

The `question` contains the rendered prompt, including:

```text
The current task is:
{
  ... row JSON ...
}
```

From that JSON you can recover:

- `Sr. No.`
- `Paragraph Reference`
- `Action - Short Name`
- `Department`
- `Obligation Summary`

### Option 2: Use batch-level `summary.json`

This is the second-best source.

It gives the mapping between:

- `item_id`
- `run_id`
- item status

The `item_id` usually looks like:

```text
<sheet>-row-<excel_row_number>-<row_id>
```

Example:

```text
Obligation-Register-with-row-17-17
```

This means:

- Excel row number: `17`
- row id / `Sr. No.`: `17`

## Concrete example

Batch folder:

```text
full-sonnet-safe-b1-1774181127-root
```

This batch covers:

- Excel rows `2-21`

One run inside it:

```text
0dbce868-f6bc-4e07-9a85-9167dc917283
```

Its trace summary is:

```text
workspace-agent-traces-private/workspace-agent-traces/full-sonnet-safe-b1-1774181127-root/0dbce868-f6bc-4e07-9a85-9167dc917283/summary.json
```

That summary shows the exact rendered task row in `question`.

Its artifact files are under:

```text
research-platform-bucket/workspace-agent/full-sonnet-safe-b1-1774181127-root/0dbce868-f6bc-4e07-9a85-9167dc917283/artifacts/
```

## If you downloaded only the artifact folders

If you downloaded only the artifact bucket contents, you usually do not have enough metadata to map every run perfectly.

That is because artifact folders do not include:

- `metadata/prompt.txt`
- `summary.json`

So if you want reliable mapping, download one of these too:

- batch trace `summary.json`
- per-run trace `summary.json`

## Practical rule

Use this mapping chain:

1. Batch folder name -> coarse Excel row range
2. Run id folder -> one exact row within that range
3. Run trace `summary.json` -> exact row/task identity

## Recommended download set

For future debugging or review, download both:

- artifact tree
- trace tree

That gives you:

- generated outputs
- exact row/task mapping
- token usage
- timing
- event trace
