# Argue Setup & Configuration

## Config Location & Precedence

Argue uses a JSON config file. Lookup order (highest priority first):

1. CLI flags (`--config <path>`)
2. Project-local: `./argue.config.json`
3. Global: `~/.config/argue/config.json`

### Init Commands

```bash
# Project-local config (recommended for repos)
argue config init --local

# Global config (for general use)
argue config init --global

# Custom path
argue config init -c /path/to/config.json
```

## Provider Types

### CLI-based providers (recommended)

Agents run via their respective CLIs — no API keys needed if you're already authenticated. A provider id that names a CLI tool implies `--type cli --cli-type <same>`, so both can be omitted:

```bash
# OpenAI Codex CLI
argue config add-provider --id codex --model-id gpt-5.4

# Google Gemini CLI
argue config add-provider --id gemini --model-id gemini-3.1-pro-preview

# Anthropic Claude CLI
argue config add-provider --id claude --model-id claude-4-sonnet

# GitHub Copilot CLI
argue config add-provider --id copilot --model-id gpt-5.4

# Other CLI types: pi, opencode, droid, amp, generic
```

For `generic` CLI type, specify `--command` and `--args`:

```bash
argue config add-provider --id custom --cli-type generic --command my-cli --args "--model,model-name"
```

### SDK-based providers

For custom adapters loaded from Node modules:

```bash
argue config add-provider --id my-sdk --type sdk --adapter ./my-adapter.js --model-id my-model
# With custom export name:
argue config add-provider --id my-sdk --type sdk --adapter ./my-adapter.js --export-name createMyProvider --model-id my-model
```

### Mock provider (testing)

```bash
argue config add-provider --id mock --type mock --model-id test
```

## Adding Agents

Agents reference providers and specify which model to use:

```bash
# Basic agent
argue config add-agent --id codex-agent --provider codex --model gpt-5.4

# Agent with role (affects debate behavior)
argue config add-agent --id devil-agent --provider claude --model claude-4-sonnet --role "devil's advocate"

# Agent with custom system prompt
argue config add-agent --id expert-agent --provider gemini --model gemini-3.1-pro-preview --system-prompt "You are a senior architect with 20 years experience."

# Agent with temperature and timeout
argue config add-agent --id creative-agent --provider openai --model gpt-5.4 --temperature 0.9 --timeout-ms 120000
```

### Shorthand: Provider + Agent in One Command

Add `--agent <id>` to `add-provider` to create both at once:

```bash
argue config add-provider --id codex --model-id gpt-5.4 --agent codex-agent
```

### Provider-Model Aliasing

Use `--provider-model` to map a generic model ID to the provider's actual model name:

```bash
argue config add-provider --id codex --model-id gpt5 --provider-model gpt-5.4
```

## Removing Providers/Agents

No CLI command exists for removal. Edit the config file directly:

```bash
# Edit with your preferred editor
code ~/.config/argue/config.json
# or for project-local
code ./argue.config.json
```

Remove entries from the `providers` object or `agents` array, then save.

## Config Schema (v1)

```json
{
  "schemaVersion": 1,
  "providers": {
    "<provider-id>": {
      "type": "cli|api|sdk|mock",
      "cliType": "codex|claude|gemini|...",
      "command": "optional-binary-name",
      "args": [],
      "models": {
        "<model-id>": { "providerModel": "optional-actual-model-name" }
      }
    }
  },
  "agents": [
    {
      "id": "<agent-id>",
      "provider": "<provider-id>",
      "model": "<model-id>",
      "role": "optional-role-description",
      "systemPrompt": "optional-system-prompt",
      "timeoutMs": 120000,
      "temperature": 0.7
    }
  ],
  "defaults": {
    "defaultAgents": ["agent-1", "agent-2"],
    "language": "optional-locale",
    "tokenBudgetHint": 100000,
    "minRounds": 2,
    "maxRounds": 3,
    "perTaskTimeoutMs": 1200000,
    "perRoundTimeoutMs": 1200000,
    "globalDeadlineMs": 3600000,
    "consensusThreshold": 1,
    "composer": "representative",
    "representativeId": "optional-agent-id",
    "includeDeliberationTrace": false,
    "traceLevel": "compact"
  },
  "output": {
    "jsonlPath": "optional-path",
    "resultPath": "optional-path",
    "summaryPath": "optional-path"
  },
  "viewer": {
    "url": "https://argue.onev.cat/"
  }
}
```

`viewer.url` overrides the hosted viewer for `argue view` / `--view`. Defaults to `https://argue.onev.cat/`. Must be `https://`, except `http://localhost` / `127.0.0.1` for local viewer development. CLI flag `--viewer-url <url>` overrides per-run.

## Composer Options

- **`representative`** (default): The highest-scoring agent writes the final report. Override which agent composes it with `--representative-id <agent-id>`.
- **`builtin`**: Synthesized summary from all agents' contributions, no per-agent representative narration.

```bash
argue run --task "..." --composer builtin
```
