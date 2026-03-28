# opencode_py

Python starter runtime that mirrors OpenCode's agent + tool shape so you can test quickly.

## What this gives you

- Built-in agents: `build`, `plan`, `general`, `explore`, `compaction`, `title`, `summary`
- Same tool names as OpenCode TS runtime (implemented or stubbed):
  - `invalid`, `question`, `bash`, `read`, `glob`, `grep`, `edit`, `write`, `task`, `todowrite`, `todoread`, `webfetch`, `websearch`, `codesearch`, `skill`, `apply_patch`, `list`, `multiedit`, `batch`, `plan_enter`, `plan_exit`, `lsp`
- Prompt loading from this repo's existing files in `packages/opencode/src/session/prompt` and `packages/opencode/src/agent/prompt`

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Environment

The runtime auto-loads env files from:

- `.env`

Supported auth vars:

- OpenAI-compatible:
  - `OPENAI_API_KEY`
  - `OPENAI_BASE_URL` (optional)
  - `OPENAI_MODEL` (optional)
  - `OPENAI_TIMEOUT` (optional, seconds; default `120`)
- Groq shortcut:
  - `GROQ_API_KEY`
  - `GROQ_BASE_URL` (optional, defaults to `https://api.groq.com/openai/v1`)
  - `GROQ_MODEL` (optional fallback if `OPENAI_MODEL` is unset)
  - `GROQ_TIMEOUT` (optional, seconds)

Example (`.env`):

```bash
GROQ_API_KEY=your_key
OPENAI_MODEL=openai/gpt-oss-120b
```

## Quick test: list agents/tools

```bash
python -m cli agents
python -m cli tools --agent build
```

## Quick test: run a tool directly

```bash
python -m cli tool read --args '{"filePath":"README.md"}'
python -m cli tool grep --args '{"pattern":"SessionPrompt","include":"packages/opencode/src/**/*.ts"}'
```

## Run agent chat loop (OpenAI-compatible)

```bash
export OPENAI_API_KEY=...
python -m cli chat "Find where tools are registered" --agent explore --model gpt-4o-mini
```

Groq example:

```bash
python -m cli chat "Find where tools are registered" --agent explore --model openai/gpt-oss-120b
```

Live visibility while running:

```bash
python -m cli chat "Find where tools are registered" \
  --agent explore \
  --model openai/gpt-oss-120b \
  --verbose-tools \
  --request-timeout 90
```

`--verbose-tools` now streams step-by-step runtime events (step start, model response, tool start/end, inferred tool calls, finish reason) in real time.
`Ctrl+C` now exits cleanly without a traceback.

Optional for compatible providers:

```bash
python -m cli chat "..." --api-base https://your-compatible-endpoint/v1 --api-key YOUR_KEY
```

## Notes

- This is a practical starter runtime, not full parity with the TypeScript implementation.
- `task` can recursively invoke another agent run in-process.
- `question`, `plan_enter`, and `plan_exit` are interactive in TTY mode and auto-select defaults in non-interactive mode.
- `lsp` is a stub currently.
- If your OpenAI-compatible server returns raw JSON tool arguments (instead of `tool_calls`), the runtime will try to infer and execute the intended tool automatically.
