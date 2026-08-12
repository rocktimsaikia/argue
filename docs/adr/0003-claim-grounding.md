# ADR 0003 - Claim grounding (evidence on claims)

## Context

Before this change, a claim's `correctness` score was derived entirely from peer stances
(`computePeerReviewCorrectness` in `packages/argue/src/core/scoring.ts`), and a claim was
`resolved` purely by vote ratio against `consensusPolicy.threshold`.

Both signals measure **agreement, not truth**. Three agents that agree on a false claim
produce a high correctness score and a unanimous resolution, and the unanimity is exactly
what makes the error invisible. The failure mode users care about is not a slow run, it is
a confident wrong consensus.

## Decision

Claims and judgements carry an `evidence` array of free-form strings, each a pointer a
reader can independently check (`path/to/file.ts:42`, a URL, a command plus its output, a
quoted passage from the task input).

### D1. No extra model turns

Evidence is produced inside the existing round outputs. No verification phase, no per-claim
refutation task, no additional agent dispatch. A debate costs the same number of model turns
as before, so grounding does not trade latency for accuracy.

### D2. Optional to parse, demanded in the prompt

`evidence` is `z.array(z.string().min(1)).default([])`, so an agent that omits it cannot
fail a whole round. The round prompt and the JSON schema handed to agents both require it
explicitly, and both state that reasoning is not evidence and that `[]` is the honest answer
when there is nothing checkable to cite. A fabricated citation is worse than an empty array.

### D3. Corroboration counts, refutation does not

A source cited while `agree`ing or `revise`-ing a peer's claim is folded into that claim's
evidence: independent corroboration is what makes a claim stronger. A source cited while
`disagree`ing argues _against_ the claim and is never folded in; it stays in the round record
and in `result.disagreements`. Merging two claims unions their evidence, so deduplication
never silently discards sources. Duplicate sources are collapsed case-insensitively.

### D4. Scoring discounts grounding; voting does not gate on it

Peer agreement is retained but multiplied by
`GROUNDING_FLOOR + (1 - GROUNDING_FLOOR) * groundingRatio`, where `groundingRatio` is the
fraction of a participant's surviving claims carrying at least one source and
`GROUNDING_FLOOR = 0.6`.

Consequences:

- An agent that cites sources outranks an equally-agreed-with agent that only asserted, and
  therefore wins representative selection and writes the report.
- If **no** participant cites anything, every participant is scaled alike and the ranking
  degrades to the previous behaviour rather than turning into noise.
- A participant who proposed no surviving claims is grounding-neutral, not penalised: a pure
  critic never had a claim to ground.

`ClaimResolution.status` stays vote-based. Gating consensus on evidence was rejected as a
silent behaviour change that would flip existing users' results; instead
`ClaimResolution.evidenceCount` makes "resolved with zero evidence" visible, the CLI tags
such claims `(no evidence)`, and the final-vote prompt instructs agents to reject claims
nobody can back.

## Consequences

- `Claim.evidence` and `ClaimJudgement.evidence` are required on the parsed output types.
  Hosts constructing these objects by hand in TypeScript must pass an array (usually `[]`).
- `ClaimResolution.evidenceCount` is a new field in `result.json` and in the viewer contract.
- Gating consensus on evidence remains available as a future opt-in policy if wanted.
