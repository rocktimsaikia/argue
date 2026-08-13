import { homedir } from "node:os";
import { dirname } from "node:path";
import pc from "picocolors";
import type { ArgueEvent, ArgueResult } from "@onevcat/argue";
import { formatMs } from "./artifacts.js";
import { createSpinner, type SpinnerStream } from "./spinner.js";

export type OutputOptions = {
  verbose?: boolean;
  noColor?: boolean;
  isTTY?: boolean;
  spinnerStream?: SpinnerStream;
  spinnerIsTTY?: boolean;
};

export type OutputIO = Pick<typeof console, "log" | "error">;

export function resultStatusTone(status: ArgueResult["status"]): "success" | "warning" | "failure" {
  if (status === "consensus") return "success";
  if (status === "failed") return "failure";
  return "warning";
}

export function createOutputFormatter(io: OutputIO, options: OutputOptions = {}) {
  const useColor = !options.noColor && !process.env.NO_COLOR && (options.isTTY ?? process.stdout.isTTY ?? false);

  const c = useColor
    ? pc
    : {
        cyan: (s: string) => s,
        dim: (s: string) => s,
        green: (s: string) => s,
        red: (s: string) => s,
        yellow: (s: string) => s,
        bold: (s: string) => s,
        magenta: (s: string) => s,
        white: (s: string) => s,
        blue: (s: string) => s
      };

  const tag = c.cyan("[argue]");
  const verbose = options.verbose ?? false;

  /**
   * Per-round tally used by the default output, which prints one line per
   * round instead of three lines per agent. Everything dropped here is still
   * in events.jsonl, and `--verbose` still prints all of it.
   */
  let roundTally: {
    label: string;
    responded: string[];
    eliminated: string[];
    newClaims: number;
    merges: number;
    timedOut: number;
    failed: number;
  } | null = null;

  const spinnerStream = options.spinnerStream ?? null;
  const spinnerIsTTY = options.spinnerIsTTY ?? spinnerStream?.isTTY ?? false;
  // A spinner earns its place only when it can redraw in place. Piped or
  // logged, the default output's one-line-per-round is the progress report,
  // and a breadcrumb would just duplicate the line that follows it.
  const spinner =
    spinnerStream && (verbose || spinnerIsTTY)
      ? createSpinner(spinnerStream, "", { isTTY: spinnerIsTTY, noColor: options.noColor })
      : null;
  let waitingFor: Set<string> = new Set();

  function stanceIcon(stance: string): string {
    if (stance === "agree") return c.green("✓");
    if (stance === "disagree") return c.red("✗");
    if (stance === "revise") return c.yellow("↻");
    return "?";
  }

  function voteIcon(vote: string): string {
    return vote === "accept" ? c.green("accept") : c.red("reject");
  }

  function indent(text: string, prefix: string): string {
    return text
      .split("\n")
      .map((line) => (line.trim().length === 0 ? "" : `${prefix}${line}`))
      .join("\n");
  }

  /** Pads before colouring: ANSI escapes would otherwise count as width. */
  function pad(text: string, width: number): string {
    return text.length >= width ? text : text + " ".repeat(width - text.length);
  }

  function beginRound(label: string): void {
    roundTally = { label, responded: [], eliminated: [], newClaims: 0, merges: 0, timedOut: 0, failed: 0 };
  }

  /** One settled line per round: who answered, and anything non-zero. */
  function flushRound(): void {
    if (!roundTally) return;
    const tally = roundTally;
    roundTally = null;

    const ticks = tally.responded.map(() => c.green("✓")).join("") + tally.eliminated.map(() => c.red("✗")).join("");

    const notes = [
      tally.newClaims > 0 ? `+${tally.newClaims} claims` : null,
      tally.merges > 0 ? `-${tally.merges} merged` : null,
      tally.timedOut > 0 ? c.yellow(`${tally.timedOut} timed out`) : null,
      tally.failed > 0 ? c.red(`${tally.failed} failed`) : null
    ].filter(Boolean);

    const detail = notes.length > 0 ? notes.join(", ") : c.dim("no change");
    io.log(`  ${c.bold(pad(tally.label, 9))}${ticks}  ${detail}`);
  }

  return {
    planResolved(args: {
      configPath: string;
      requestId: string;
      task: string;
      agents: string[];
      rounds: string;
      composer: string;
      jsonlPath: string;
    }) {
      if (!verbose) {
        // The config path was typed by the caller, the requestId is repeated by
        // the view hint at the end, and the events path lives with the other
        // artefacts. None of them earn a line here.
        io.log(`${c.bold("argue")} ${c.dim("·")} ${args.agents.join(", ")} ${c.dim(`· rounds ${args.rounds}`)}`);
        // One line: the caller just typed this task, and the full text is in
        // result.json. Re-wrapping a long prompt over six lines helps nobody.
        io.log(c.dim(`  ${truncate(args.task, 96)}`));
        io.log("");
        return;
      }

      io.log(`${tag} ${c.bold("run started")}`);
      io.log(c.dim(`  config: ${args.configPath}`));
      io.log(c.dim(`  requestId: ${args.requestId}`));
      io.log(`  task: ${args.task}`);
      io.log(`  agents: ${args.agents.join(", ")}`);
      io.log(c.dim(`  rounds: ${args.rounds} | composer: ${args.composer}`));
      io.log(c.dim(`  events: ${args.jsonlPath}`));
    },

    createEventHandler(): (event: ArgueEvent) => void {
      return (event) => {
        const payload = event.payload ?? {};
        const phase = readString(payload.phase);
        const round = readNumber(payload.round);
        const roundTag = formatRoundTag(phase, round);

        // Any event arriving means there is news to print. Stop the spinner
        // first so log lines start at column 0; the spinner is rearmed below
        // only when we are about to wait again.
        spinner?.stop();

        if (event.type === "RoundDispatched") {
          const participants = readStringArray(payload.participants);
          waitingFor = new Set(participants);

          if (!verbose) {
            beginRound(phaseLabel(phase, round));
            if (waitingFor.size > 0) {
              spinner?.start(waitLabel(phase, round, waitingFor));
            }
            return;
          }

          io.log(`${tag} ${c.bold(roundTag)} dispatched ${c.dim("-> " + participants.join(", "))}`);
          if (waitingFor.size > 0) {
            spinner?.start(`${roundTag} waiting on ${[...waitingFor].join(", ")}…`);
          }
          return;
        }

        if (event.type === "ParticipantResponded") {
          const participantId = readString(payload.participantId) ?? "unknown";
          const extractedClaims = readNumber(payload.extractedClaims) ?? 0;
          const stanceAgree = readNumber(payload.stanceAgree) ?? 0;
          const stanceDisagree = readNumber(payload.stanceDisagree) ?? 0;
          const stanceRevise = readNumber(payload.stanceRevise) ?? 0;
          const claimVotes = readNumber(payload.claimVotes) ?? 0;
          const judgementParts = [
            stanceAgree > 0 ? `${stanceAgree}✓` : null,
            stanceDisagree > 0 ? `${stanceDisagree}✗` : null,
            stanceRevise > 0 ? `${stanceRevise}↻` : null
          ]
            .filter(Boolean)
            .join(" ");
          const judgementStr = judgementParts || "0";

          if (!verbose) {
            roundTally?.responded.push(participantId);
            waitingFor.delete(participantId);
            if (waitingFor.size > 0) {
              spinner?.start(waitLabel(phase, round, waitingFor));
            }
            return;
          }

          const stats = c.dim(`(claims+${extractedClaims}, judgements=${judgementStr}, votes=${claimVotes})`);
          io.log(`${tag} ${c.bold(roundTag)} ${c.blue(participantId)} responded ${stats}`);

          const summary = readString(payload.summary);
          if (summary) {
            io.log(c.dim(`  ${singleLine(summary)}`));
          }

          if (verbose) {
            printVerboseResponse(payload);
          }
          waitingFor.delete(participantId);
          if (waitingFor.size > 0) {
            spinner?.start(`${roundTag} waiting on ${[...waitingFor].join(", ")}…`);
          }
          return;
        }

        if (event.type === "ParticipantEliminated") {
          const participantId = readString(payload.participantId) ?? "unknown";
          const reason = readString(payload.reason) ?? "unknown";
          const errorMessage = readString(payload.error);

          let suffix = `(${reason})`;
          if (reason === "error" && errorMessage) {
            suffix += ` - ${errorMessage}`;
          }

          roundTally?.eliminated.push(participantId);
          io.log(
            verbose
              ? `${tag} ${c.bold(roundTag)} ${c.red(`${participantId} eliminated`)} ${c.dim(suffix)}`
              : `  ${c.red(`${participantId} eliminated`)} ${c.dim(`${phaseLabel(phase, round)} ${suffix}`)}`
          );
          waitingFor.delete(participantId);
          if (waitingFor.size > 0) {
            spinner?.start(
              verbose ? `${roundTag} waiting on ${[...waitingFor].join(", ")}…` : waitLabel(phase, round, waitingFor)
            );
          }
          return;
        }

        if (event.type === "ClaimsMerged") {
          const source = readString(payload.sourceClaimId) ?? "?";
          const mergedInto = readString(payload.mergedInto) ?? "?";
          if (verbose) {
            io.log(`${tag} ${c.bold(roundTag)} ${c.yellow(`claim merged ${source} -> ${mergedInto}`)}`);
          }
          if (waitingFor.size > 0) {
            spinner?.start(
              verbose ? `${roundTag} waiting on ${[...waitingFor].join(", ")}…` : waitLabel(phase, round, waitingFor)
            );
          }
          return;
        }

        if (event.type === "RoundCompleted") {
          const completed = readNumber(payload.completed) ?? 0;
          const timedOut = readNumber(payload.timedOut) ?? 0;
          const failed = readNumber(payload.failed) ?? 0;
          const claimCatalogSize = readNumber(payload.claimCatalogSize) ?? 0;
          const newClaims = readNumber(payload.newClaims) ?? 0;
          const mergeCount = readNumber(payload.mergeCount) ?? 0;

          if (!verbose) {
            if (roundTally) {
              roundTally.newClaims = newClaims;
              roundTally.merges = mergeCount;
              roundTally.timedOut = timedOut;
              roundTally.failed = failed;
            }
            flushRound();
            waitingFor.clear();
            return;
          }

          io.log(
            c.dim(
              `${tag} ${roundTag} completed: done=${completed} timeout=${timedOut} failed=${failed} claims=${claimCatalogSize} (+${newClaims}, -${mergeCount})`
            )
          );
          waitingFor.clear();
          return;
        }

        if (event.type === "GlobalDeadlineHit") {
          io.log(verbose ? `${tag} ${c.red("global deadline hit")}` : `  ${c.red("global deadline hit")}`);
          return;
        }

        if (event.type === "EarlyStopTriggered") {
          io.log(verbose ? `${tag} ${c.yellow(`early stop triggered at ${roundTag}`)}` : c.dim("  early stop"));
          return;
        }

        if (event.type === "ReportDispatched") {
          const reporterId = readString(payload.reporterId) ?? "unknown";
          if (verbose) {
            io.log(`${tag} ${c.magenta(`report dispatched -> ${reporterId}`)}`);
          }
          spinner?.start(verbose ? `composing report via ${reporterId}…` : "report…");
          return;
        }

        if (event.type === "ActionDispatched") {
          const actorId = readString(payload.actorId) ?? "unknown";
          const prompt = readString(payload.prompt) ?? "";
          io.log(`${tag} ${c.magenta(`action dispatched -> ${actorId}`)}`);
          if (verbose && prompt) {
            io.log(c.dim(`  prompt: ${singleLine(prompt)}`));
          }
          spinner?.start(`${actorId} executing action…`);
          return;
        }

        if (event.type === "ActionCompleted") {
          const actorId = readString(payload.actorId) ?? "unknown";
          const summary = readString(payload.summary);
          io.log(`${tag} ${c.green(`action completed by ${actorId}`)}`);
          if (summary) {
            for (const line of summary.split("\n")) {
              io.log(c.dim(`  ${line}`));
            }
          }
          return;
        }

        if (event.type === "ActionFailed") {
          const actorId = readString(payload.actorId) ?? "unknown";
          const reason = readString(payload.reason) ?? "unknown";
          io.log(`${tag} ${c.red(`action failed for ${actorId}`)} ${c.dim(`(${reason})`)}`);
          return;
        }

        if (event.type === "ReportCompleted") {
          const mode = readString(payload.mode) ?? "unknown";
          const reason = readString(payload.reason);
          const suffix = reason ? c.dim(` (fallback: ${reason})`) : "";
          if (verbose) {
            io.log(`${tag} ${c.magenta(`report completed: ${mode}`)}${suffix}`);
          } else if (reason) {
            // A silent fallback to the builtin composer changes what you read.
            io.log(`  ${c.yellow(`report fell back to ${mode}`)} ${c.dim(`(${reason})`)}`);
          }
        }
      };
    },

    viewHint(requestId: string) {
      io.log(c.dim(`→ View report: argue view ${requestId}`));
    },

    runCompleted(result: ArgueResult, paths: { resultPath: string; summaryPath: string }) {
      spinner?.stop();

      const statusTone = resultStatusTone(result.status);
      const statusColor = statusTone === "success" ? c.green : statusTone === "warning" ? c.yellow : c.red;

      if (!verbose) {
        io.log("");
        io.log(
          `${statusColor(c.bold(result.status))} ${c.dim("·")} ${result.representative.participantId} ${c.dim(`(${formatNumber(result.representative.score)})`)}`
        );

        if (result.report.finalSummary) {
          io.log("");
          io.log(indent(plainText(result.report.finalSummary), "  "));
        }

        printClaimDigest(result);
        printArtifacts(paths);
        return;
      }

      io.log("");
      io.log(c.dim("─".repeat(60)));
      io.log("");

      io.log(`${tag} ${c.bold("result:")} ${statusColor(result.status)}`);
      io.log(
        `  representative: ${c.bold(result.representative.participantId)} ${c.dim(`(score: ${formatNumber(result.representative.score)})`)}`
      );

      if (result.report.finalSummary) {
        io.log("");
        io.log(c.bold("  Conclusion:"));
        io.log(`  ${result.report.finalSummary}`);
      }

      printVerboseResult(result);

      io.log("");
      io.log(c.dim(`  result: ${paths.resultPath}`));
      io.log(c.dim(`  summary: ${paths.summaryPath}`));
    },

    runFailed(error: unknown, errorPath: string) {
      spinner?.stop();
      io.log("");
      if (verbose) {
        io.log(c.dim("─".repeat(60)));
        io.log("");
      }
      io.error(`${tag} ${c.red(c.bold("run failed"))}: ${String(error)}`);
      io.log(c.dim(`  error: ${contractPath(errorPath)}`));
    }
  };

  /**
   * The surviving claims, one line each, with what backs them. Merged and
   * withdrawn claims are omitted: they are bookkeeping, not conclusions.
   */
  function printClaimDigest(result: ArgueResult): void {
    const active = result.finalClaims.filter((claim) => claim.status === "active");
    if (active.length === 0) return;

    const idWidth = Math.max(...active.map((claim) => claim.claimId.length));
    const titles = new Map(active.map((claim) => [claim.claimId, truncate(claim.title, 44)]));
    const titleWidth = Math.max(...[...titles.values()].map((title) => title.length));
    io.log("");

    for (const claim of active) {
      const resolution = result.claimResolutions.find((r) => r.claimId === claim.claimId);
      const verdict = resolution
        ? (resolution.status === "resolved" ? c.green : c.red)(
            `${resolution.acceptCount}/${resolution.totalVoters} ${resolution.status === "resolved" ? "accept" : "unresolved"}`
          )
        : c.dim("no vote");

      const sources =
        claim.evidence.length > 0
          ? c.dim(`${claim.evidence.length} source${claim.evidence.length === 1 ? "" : "s"}`)
          : c.yellow("no evidence");

      const title = titles.get(claim.claimId) ?? claim.title;
      io.log(`  ${c.dim(pad(claim.claimId, idWidth))}  ${pad(title, titleWidth)}  ${verdict}  ${sources}`);
    }
  }

  /**
   * The result JSON is the artefact that gets piped into the next step, so it
   * is named in full — it also spells out the run directory the summary and
   * events sit in. The summary only earns its own line when the caller pointed
   * it somewhere else.
   */
  function printArtifacts(paths: { resultPath: string; summaryPath: string }): void {
    io.log("");
    io.log(c.dim(`  result: ${contractPath(paths.resultPath)}`));

    if (dirname(paths.resultPath) !== dirname(paths.summaryPath)) {
      io.log(c.dim(`  summary: ${contractPath(paths.summaryPath)}`));
    }
  }

  function printVerboseResponse(payload: Record<string, unknown>): void {
    // Extracted claims
    const claims = readArray(payload.extractedClaimsDetail);
    if (claims.length > 0) {
      io.log(c.dim("  ┌ extracted claims:"));
      for (const claim of claims) {
        const obj = claim as Record<string, unknown>;
        const id = readString(obj.claimId) ?? "?";
        const title = readString(obj.title) ?? "";
        const category = readString(obj.category);
        const catTag = category ? c.dim(` [${category}]`) : "";
        io.log(c.dim(`  │ ${c.bold(id)}: ${title}${catTag}`));
        const statement = readString(obj.statement);
        if (statement) {
          io.log(c.dim(`  │   ${singleLine(statement)}`));
        }
      }
      io.log(c.dim("  └"));
    }

    // Judgements
    const judgements = readArray(payload.judgementsDetail);
    if (judgements.length > 0) {
      io.log(c.dim("  ┌ judgements:"));
      for (const j of judgements) {
        const obj = j as Record<string, unknown>;
        const claimId = readString(obj.claimId) ?? "?";
        const stance = readString(obj.stance) ?? "?";
        const confidence = readNumber(obj.confidence);
        const confStr = confidence !== undefined ? c.dim(` (${(confidence * 100).toFixed(0)}%)`) : "";
        io.log(`  │ ${stanceIcon(stance)} ${c.bold(claimId)}${confStr}`);
        const rationale = readString(obj.rationale);
        if (rationale) {
          io.log(c.dim(`  │   ${singleLine(rationale)}`));
        }
        const revised = readString(obj.revisedStatement);
        if (revised) {
          io.log(c.dim(`  │   ${c.yellow("revised:")} ${singleLine(revised)}`));
        }
      }
      io.log(c.dim("  └"));
    }

    // Claim votes (final_vote phase)
    const votes = readArray(payload.claimVotesDetail);
    if (votes.length > 0) {
      io.log(c.dim("  ┌ votes:"));
      for (const v of votes) {
        const obj = v as Record<string, unknown>;
        const claimId = readString(obj.claimId) ?? "?";
        const vote = readString(obj.vote) ?? "?";
        const reason = readString(obj.reason);
        const reasonStr = reason ? c.dim(` — ${singleLine(reason)}`) : "";
        io.log(`  │ ${voteIcon(vote)} ${c.bold(claimId)}${reasonStr}`);
      }
      io.log(c.dim("  └"));
    }

    // Full response
    const fullResponse = readString(payload.fullResponse);
    if (fullResponse) {
      io.log(c.dim("  ┌ full response:"));
      io.log(indent(c.dim(fullResponse), "  │ "));
      io.log(c.dim("  └"));
    }
  }

  function printVerboseResult(result: ArgueResult): void {
    // Representative speech
    if (result.report.representativeSpeech) {
      io.log("");
      io.log(c.bold("  Representative speech:"));
      io.log(`  ${result.report.representativeSpeech}`);
    }

    // Scoreboard
    if (result.scoreboard.length > 0) {
      io.log("");
      io.log(c.bold("  Scoreboard:"));
      const sorted = [...result.scoreboard].sort((a, b) => b.total - a.total);
      for (const entry of sorted) {
        const breakdown = entry.breakdown;
        const parts: string[] = [];
        if (breakdown?.correctness !== undefined) parts.push(`cor=${formatNumber(breakdown.correctness)}`);
        if (breakdown?.completeness !== undefined) parts.push(`cpl=${formatNumber(breakdown.completeness)}`);
        if (breakdown?.actionability !== undefined) parts.push(`act=${formatNumber(breakdown.actionability)}`);
        if (breakdown?.consistency !== undefined) parts.push(`con=${formatNumber(breakdown.consistency)}`);
        const breakdownStr = parts.length > 0 ? c.dim(` (${parts.join(", ")})`) : "";
        io.log(`  ${c.bold(entry.participantId)}: ${formatNumber(entry.total)}${breakdownStr}`);
      }
    }

    // Final claims
    if (result.finalClaims.length > 0) {
      io.log("");
      io.log(c.bold("  Claims:"));
      for (const claim of result.finalClaims) {
        const catTag = claim.category ? c.dim(` [${claim.category}]`) : "";
        const statusTag = claim.status !== "active" ? c.dim(` (${claim.status})`) : "";
        io.log(`  ${c.bold(claim.claimId)}: ${claim.title}${catTag}${statusTag}`);
        io.log(c.dim(`    ${claim.statement}`));
        io.log(c.dim(`    proposed by: ${claim.proposedBy.join(", ")}`));

        if (claim.evidence.length > 0) {
          io.log(c.dim(`    evidence: ${claim.evidence.join(" | ")}`));
        }

        // Show resolution for this claim
        const resolution = result.claimResolutions.find((r) => r.claimId === claim.claimId);
        if (resolution) {
          const resColor = resolution.status === "resolved" ? c.green : c.red;
          // A claim the agents voted through without a single source is the
          // failure mode this whole tool exists to avoid — name it on the spot.
          const groundingTag =
            resolution.status === "resolved" && resolution.evidenceCount === 0 ? c.yellow(" (no evidence)") : "";
          io.log(
            `    ${resColor(resolution.status)}${groundingTag}: ${resolution.acceptCount}/${resolution.totalVoters} accept, ${resolution.rejectCount}/${resolution.totalVoters} reject`
          );
        }
      }
    }

    // Disagreements
    if (result.disagreements && result.disagreements.length > 0) {
      io.log("");
      io.log(c.bold("  Disagreements:"));
      for (const d of result.disagreements) {
        io.log(`  ${c.red("✗")} ${c.bold(d.claimId)} by ${d.participantId}: ${d.reason}`);
      }
    }

    // Eliminations
    if (result.eliminations.length > 0) {
      io.log("");
      io.log(c.bold("  Eliminations:"));
      for (const e of result.eliminations) {
        io.log(`  ${c.red(e.participantId)} at round ${e.round} (${e.reason})`);
      }
    }

    // Action
    if (result.action) {
      io.log("");
      io.log(c.bold("  Action:"));
      const statusColor = result.action.status === "completed" ? c.green : c.red;
      io.log(`  ${statusColor(result.action.status)} by ${result.action.actorId}`);
      if (result.action.summary) {
        io.log(`  ${result.action.summary}`);
      }
      if (result.action.error) {
        io.log(`  ${c.red(`error: ${result.action.error}`)}`);
      }
      if (result.action.fullResponse) {
        io.log(c.dim("  ┌ full response:"));
        io.log(indent(c.dim(result.action.fullResponse), "  │ "));
        io.log(c.dim("  └"));
      }
    }

    // Metrics
    io.log("");
    io.log(c.bold("  Metrics:"));
    const m = result.metrics;
    io.log(
      c.dim(
        `  elapsed=${formatMs(m.elapsedMs)} rounds=${m.totalRounds} turns=${m.totalTurns} retries=${m.retries} timeouts=${m.waitTimeouts}`
      )
    );
    if (m.earlyStopTriggered) io.log(c.dim("  early stop: yes"));
    if (m.globalDeadlineHit) io.log(c.dim("  global deadline hit: yes"));
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Spinner label for the default output; it redraws, so name the stragglers. */
function waitLabel(phase: string | undefined, round: number | undefined, waiting: Set<string>): string {
  return `${phaseLabel(phase, round)} waiting on ${[...waiting].join(", ")}…`;
}

/** Human phase name for the default output: "initial", "debate 2", "vote". */
function phaseLabel(phase: string | undefined, round: number | undefined): string {
  if (phase === "initial") return "initial";
  if (phase === "final_vote") return "vote";
  if (phase === "debate") return round === undefined ? "debate" : `debate ${round}`;
  return formatRoundTag(phase, round);
}

/** Home directory collapsed to `~`, so a path fits on one line. */
function contractPath(path: string): string {
  const home = homedir();
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * Terminals do not render markdown, so emphasis markers that reach them are
 * just noise. The engine's builtin summary is markdown by design.
 */
function plainText(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/^#{1,6}\s+/gm, "");
}

function truncate(value: string, maxChars: number): string {
  const flat = singleLine(value);
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`;
}

function formatRoundTag(phase: string | undefined, round: number | undefined): string {
  if (phase !== undefined && round !== undefined) return `${phase}#${round}`;
  if (phase !== undefined) return phase;
  if (round !== undefined) return `#${round}`;
  return "unknown";
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
