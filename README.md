# argue

**[中文](README_CN.md) | [日本語](README_JP.md)**

> _Follow the argument wherever it leads._ — Socrates, in Plato's _Republic_

argue is a structured multi-agent debate engine. Multiple AI agents analyze the same problem independently, challenge each other's claims across rounds, and converge on consensus through voting — producing higher quality results than any single agent alone.

## Install

```bash
npm install -g @onevcat/argue-cli
```

## Configure

```bash
# Create config file (~/.config/argue/config.json)
argue config init

# Add providers and agents
argue config add-provider --id claude --type cli --cli-type claude --model-id sonnet --agent claude-agent
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.3-codex --agent codex-agent
```

## Run a Debate

```bash
argue run --task "Should we use a monorepo or polyrepo for our microservices?"
```

Add `--verbose` to see each agent's full response, claims, and judgements instead of the summary view.

Need an agent to **act** on the result? Add `--action`:

```bash
argue run \
  --task "Review the issue: https://github.com/onevcat/argue/issues/22" \
  --action "Fix the issue based on consensus and open a PR" \
  --verbose
```

Run `argue --help` for the full list of flags.
