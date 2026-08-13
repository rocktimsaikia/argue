# argue

> _Follow the argument wherever it leads._ — Socrates, in Plato's _Republic_

argue is a structured multi-agent debate engine. Multiple AI agents analyze the same problem independently, challenge each other's claims across rounds, and converge on consensus through voting — producing higher quality results than any single agent alone.

This is a personal fork of [@onevcat/argue](https://github.com/onevcat/argue). It is not published to npm — run it from the repo.

## Install

```bash
git clone -b rocktim https://github.com/rocktimsaikia/argue
cd argue

npm install
npm run build              # the bin runs dist/, so this is required

cd packages/argue-cli
npm link                   # puts `argue` on your PATH, symlinked to this repo
```

Check it: `argue --version`.

The link points at `packages/argue-cli/dist/cli.js`, and npm workspaces resolve the library to `packages/argue`. Both halves therefore stay in lockstep with your working tree — which matters, because this fork changes the result schema in the library and the output in the CLI. Installing the published `@onevcat/argue-cli` instead would pair a forked CLI with the upstream library and crash.

**After editing source, run `npm run build`** or the `argue` on your PATH keeps serving the previous `dist/`. `git push` also rebuilds, via the pre-push hook.

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
